from __future__ import annotations

import re
from typing import Any, Literal

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
    """Durée d'engagement parsée depuis `pricing.engagement` ('X mois'), défaut 1 (comme QuoteFlow)."""
    pricing = item.get("pricing") or {}
    eng = pricing.get("engagement") if isinstance(pricing, dict) else None
    if isinstance(eng, str):
        match = re.search(r"(\d+)\s*mois", eng.lower())
        if match:
            return int(match.group(1))
    return 1


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
    # Remise commerciale supplémentaire, optionnelle, empilée par-dessus la remise standard (défaut 0).
    extra_factor = 1 - request.discount_percent / 100
    monthly_public_total = 0.0
    monthly_discounted_total = 0.0
    engagement_total_sum = 0.0

    for line in request.lines:
        source, item, public_unit_price = _resolve_line(line)

        # Remise standard catalogue appliquée automatiquement (comme QuoteFlow),
        # puis remise commerciale supplémentaire empilée.
        standard_pct = _standard_discount_percent(item)
        discounted_unit_price = public_unit_price * (1 - standard_pct / 100) * extra_factor

        public_monthly_total = public_unit_price * line.quantity
        monthly_total = discounted_unit_price * line.quantity

        engagement_months = _engagement_months(item)
        engagement_total = monthly_total * engagement_months

        monthly_public_total += public_monthly_total
        monthly_discounted_total += monthly_total
        engagement_total_sum += engagement_total

        response_lines.append(
            QuoteLineResponse(
                sku=line.sku,
                name=line.label or item.get("name") or line.sku,
                source=source,
                unit=item.get("unit"),
                quantity=line.quantity,
                public_unit_price=_round_unit(public_unit_price),
                discounted_unit_price=_round_unit(discounted_unit_price),
                standard_discount_percent=round(standard_pct, 2),
                monthly_total=_round_money(monthly_total),
                engagement_months=engagement_months,
                engagement_total=_round_money(engagement_total),
            )
        )

    return QuoteResponse(
        status="success",
        period_months=request.period_months,
        discount_percent=request.discount_percent,
        lines=response_lines,
        monthly_public_total=_round_money(monthly_public_total),
        monthly_discounted_total=_round_money(monthly_discounted_total),
        period_public_total=_round_money(monthly_public_total * request.period_months),
        period_discounted_total=_round_money(monthly_discounted_total * request.period_months),
        savings_total=_round_money((monthly_public_total - monthly_discounted_total) * request.period_months),
        total_on_engagement=_round_money(engagement_total_sum),
    )
