from __future__ import annotations

import re
from typing import Any, Literal, Optional

from fastapi import HTTPException

from .catalog import find_catalog_item
from .licenses import find_license_item
from .models import QuoteLineRequest, QuoteLineResponse, QuoteRequest, QuoteResponse


def _round_money(value: float) -> float:
    return round(value + 0.0000001, 2)


def _round_unit(value: float) -> float:
    return round(value + 0.0000001, 4)


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ".").replace(" EUR", "").replace("€", "").strip())
    except ValueError:
        return default


def _catalog_price(item: dict) -> float:
    pricing = item.get("pricing_summary") or {}
    return float(pricing.get("public_price") or 0)


def _license_price(item: dict) -> float:
    price = item.get("price")
    if price is not None:
        return float(price)
    pricing = item.get("pricing") or {}
    return float(pricing.get("public_price") or 0)


def _standard_discount_percent(item: dict) -> float:
    """Remise standard catalogue du produit (`pricing.discounts.standard`), comme QuoteFlow."""
    pricing = item.get("pricing") or {}
    discounts = pricing.get("discounts") if isinstance(pricing, dict) else None
    if isinstance(discounts, dict) and discounts.get("standard") is not None:
        return _to_float(discounts.get("standard"))
    return 0.0


def _engagement_months(item: dict) -> int:
    """Durée d'engagement catalogue parsée depuis `pricing.engagement` ('X mois'), défaut 1."""
    pricing = item.get("pricing") or {}
    eng = pricing.get("engagement") if isinstance(pricing, dict) else None
    if isinstance(eng, str):
        match = re.search(r"(\d+)\s*mois", eng.lower())
        if match:
            return int(match.group(1))
    return 1


def _term_info(source: str, item: dict) -> tuple[Optional[str], int, bool]:
    """Nature tarifaire d'une ligne : (term, term_months, recurring).

    - `term_months` : nombre de mois couverts par le prix natif. Sert à ramener un
      prix annuel/pluriannuel à son mensuel équivalent (amortissement) — sinon le
      prix d'un bundle annuel serait compté comme un mensuel et multiplié par la
      projection (sur-comptage ×12 à ×36).
    - `recurring` : True = coût mensuel récurrent ; False = coût ponctuel (licence
      perpétuelle / one-shot), ajouté une seule fois et JAMAIS multiplié par la projection.

    Catalogue (IaaS) : toujours mensuel récurrent. Licences : terme porté par
    `pricing.term`, durée d'un pluriannuel par `pricing.engagement` (nombre d'années) —
    PAS le suffixe du SKU (220 SKU incohérents observés). Tout terme inconnu ou
    perpétuel est traité comme ponctuel (prudent : on ne multiplie jamais un prix
    de période inconnu par la projection)."""
    if source != "license":
        return None, 1, True  # catalogue : mensuel récurrent
    pricing = item.get("pricing") or {}
    term = pricing.get("term") if isinstance(pricing, dict) else None
    key = str(term or "").strip().lower()
    if key == "monthly":
        return term, 1, True
    if key == "annual":
        return term, 12, True
    if key == "multiyear":
        years = pricing.get("engagement") if isinstance(pricing, dict) else None
        if isinstance(years, (int, float)) and years > 0:
            return term, int(years) * 12, True
        return term, 0, False  # pluriannuel 'Perpetuel' -> ponctuel
    return term, 0, False  # None / perpétuel / one-shot / inconnu -> ponctuel


def _resolve_line(line: QuoteLineRequest) -> tuple[Literal["catalog", "license"], dict, float]:
    if line.source in {"auto", "catalog"}:
        item = find_catalog_item(line.sku)
        if item:
            return "catalog", item, _catalog_price(item)

    if line.source in {"auto", "license"}:
        item = find_license_item(line.sku)
        if item:
            return "license", item, _license_price(item)

    raise HTTPException(status_code=404, detail=f"SKU introuvable: {line.sku}")


def calculate_quote(request: QuoteRequest) -> QuoteResponse:
    response_lines: list[QuoteLineResponse] = []
    # Prix publics par défaut. La remise catalogue (taux par produit) n'est
    # appliquée QU'EN mode partenaire ; `discount_percent` est une remise
    # additionnelle optionnelle (masquée dans l'UI publique, défaut 0).
    partner = request.partner
    # `discount_percent` (remise additionnelle, masquée dans l'UI) ne s'applique
    # QU'EN mode partenaire : un client public ne doit JAMAIS être remisé, même si
    # une valeur résiduelle (devis ancien persisté) ou un client API legacy l'envoie.
    # On expose la remise EFFECTIVE (0 hors partenaire) pour que tout consommateur
    # de la réponse (exports, UI) ne calcule pas une remise fantôme.
    effective_discount = request.discount_percent if partner else 0.0
    extra_factor = 1 - effective_discount / 100
    period = request.period_months
    monthly_public_total = 0.0
    monthly_discounted_total = 0.0
    one_time_public_total = 0.0
    one_time_discounted_total = 0.0
    engagement_total_sum = 0.0

    for line in request.lines:
        source, item, public_unit_price = _resolve_line(line)

        # En mode partenaire : remise catalogue par produit ; sinon 0 (prix public).
        standard_pct = _standard_discount_percent(item) if partner else 0.0
        discounted_unit_price = public_unit_price * (1 - standard_pct / 100) * extra_factor

        term, term_months, recurring = _term_info(source, item)
        qty = line.quantity

        if recurring:
            # Prix natif amorti sur les mois couverts (term_months) -> mensuel équivalent.
            months = term_months or 1
            monthly_total = (discounted_unit_price / months) * qty
            one_time_total = 0.0
            # Engagement : durée du terme pour une licence, champ 'X mois' pour le catalogue.
            engagement_months = term_months if source == "license" else _engagement_months(item)
            engagement_total = monthly_total * engagement_months
            monthly_public_total += (public_unit_price / months) * qty
            monthly_discounted_total += monthly_total
        else:
            # Coût ponctuel (perpétuel / one-shot) : compté une seule fois, hors projection.
            monthly_total = 0.0
            one_time_total = discounted_unit_price * qty
            engagement_months = 0
            engagement_total = one_time_total
            one_time_public_total += public_unit_price * qty
            one_time_discounted_total += one_time_total

        engagement_total_sum += engagement_total

        response_lines.append(
            QuoteLineResponse(
                sku=line.sku,
                name=line.label or item.get("name") or line.sku,
                source=source,
                unit=item.get("unit"),
                quantity=qty,
                public_unit_price=_round_unit(public_unit_price),
                discounted_unit_price=_round_unit(discounted_unit_price),
                standard_discount_percent=round(standard_pct, 2),
                term=term,
                term_months=term_months,
                recurring=recurring,
                monthly_total=_round_money(monthly_total),
                one_time_total=_round_money(one_time_total),
                engagement_months=engagement_months,
                engagement_total=_round_money(engagement_total),
            )
        )

    # Projection = récurrent mensuel × période + coûts ponctuels (une seule fois).
    period_public_total = monthly_public_total * period + one_time_public_total
    period_discounted_total = monthly_discounted_total * period + one_time_discounted_total

    return QuoteResponse(
        status="success",
        partner=partner,
        period_months=period,
        discount_percent=effective_discount,
        lines=response_lines,
        monthly_public_total=_round_money(monthly_public_total),
        monthly_discounted_total=_round_money(monthly_discounted_total),
        one_time_total=_round_money(one_time_discounted_total),
        period_public_total=_round_money(period_public_total),
        period_discounted_total=_round_money(period_discounted_total),
        savings_total=_round_money(period_public_total - period_discounted_total),
        total_on_engagement=_round_money(engagement_total_sum),
    )
