from app import quote as quote_mod
from app.models import QuoteLineRequest, QuoteRequest
from app.quote import calculate_quote


def _license_item(term, engagement, price, sku="LIC-TERM-TEST"):
    """Licence synthétique au format de find_license_item (pricing.term + engagement)."""
    return {
        "sku": sku,
        "name": f"Licence {term}",
        "unit": "licence",
        "pricing": {"term": term, "engagement": engagement, "public_price": price},
        "price": price,
    }


def test_quote_public_prices_by_default():
    # Décision métier : par défaut (pas de mode partenaire), AUCUNE remise.
    # csp:fr1:iaas:storage:bloc:medium:v1 : public 0.0756, discounts.standard 25%, engagement "1 mois".
    request = QuoteRequest(
        period_months=12,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert quote.status == "success"
    assert quote.partner is False
    assert line.standard_discount_percent == 0           # remise catalogue NON appliquée
    assert line.public_unit_price == 0.0756
    assert line.discounted_unit_price == 0.0756          # == prix public
    assert line.monthly_total == 77.41                   # 0.0756 * 1024
    assert quote.period_discounted_total == 928.97       # 77.4144 * 12, sans remise
    assert quote.savings_total == 0


def test_quote_partner_mode_applies_catalog_discount():
    # Mode partenaire : la remise catalogue par produit (ici 25%) s'applique.
    request = QuoteRequest(
        period_months=12,
        partner=True,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert quote.partner is True
    assert line.standard_discount_percent == 25
    assert line.discounted_unit_price == 0.0567          # 0.0756 * 0.75
    assert line.monthly_total == 58.06
    assert quote.period_discounted_total == 696.73


def test_quote_multi_month_engagement_public_by_default():
    # csp:fr1:network:epl:1g:v1 : public 1300.80, standard 25%, engagement "36 mois".
    # Sans mode partenaire -> prix public, pas de remise, mais engagement conservé.
    request = QuoteRequest(
        lines=[QuoteLineRequest(sku="csp:fr1:network:epl:1g:v1", quantity=1)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.standard_discount_percent == 0
    assert line.discounted_unit_price == 1300.80         # prix public
    assert line.monthly_total == 1300.80
    assert line.engagement_months == 36
    assert line.engagement_total == 46828.80             # 1300.80 * 36
    assert quote.total_on_engagement == 46828.80


def test_quote_partner_multi_month_engagement():
    request = QuoteRequest(
        partner=True,
        lines=[QuoteLineRequest(sku="csp:fr1:network:epl:1g:v1", quantity=1)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.discounted_unit_price == 975.60          # 1300.80 * 0.75
    assert line.engagement_total == 35121.60             # 975.60 * 36
    assert quote.total_on_engagement == 35121.60


def test_quote_manual_discount_stacks_in_partner_mode():
    # `discount_percent` (masqué dans l'UI publique, dispo via l'API) s'empile sur
    # la remise partenaire. Verrouille le contrat API du levier « engagement » futur.
    request = QuoteRequest(
        partner=True,
        discount_percent=25,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    # 0.0756 * 0.75 (partenaire) * 0.75 (manuel) = 0.042525
    assert quote.lines[0].discounted_unit_price == 0.0425
    assert quote.lines[0].monthly_total == 43.55         # 0.042525 * 1024


def test_quote_manual_discount_ignored_without_partner():
    # Garde-fou (revue) : hors mode partenaire, une remise manuelle résiduelle
    # (devis ancien persisté) ou un client API legacy NE DOIT PAS remiser le
    # client public -> prix public strict.
    request = QuoteRequest(
        partner=False,
        discount_percent=25,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    assert quote.partner is False
    assert quote.lines[0].standard_discount_percent == 0
    assert quote.lines[0].discounted_unit_price == 0.0756  # prix public, remise IGNORÉE
    assert quote.savings_total == 0


# --------------------------------------------------------------------------- #
# Bug L4 : prise en compte du terme tarifaire des licences (annual / multiyear /
# perpétuel). Sans cela, un prix de période (annuel/pluriannuel) était compté comme
# un mensuel et multiplié par la projection -> sur-comptage ×12 à ×36.
# --------------------------------------------------------------------------- #
def test_quote_annual_license_amortized_not_counted_as_monthly(monkeypatch):
    # Licence annuelle : prix = total/an (7551,91). Projection 12 mois = 1 an = 7551,91, PAS 90 622.
    monkeypatch.setattr(quote_mod, "find_license_item", lambda sku: _license_item("annual", 1, 7551.91))
    request = QuoteRequest(period_months=12, lines=[QuoteLineRequest(sku="LIC-TERM-TEST", source="license")])

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.recurring is True
    assert line.term == "annual"
    assert line.term_months == 12
    assert line.public_unit_price == 7551.91          # prix natif annuel conservé
    assert line.monthly_total == 629.33               # 7551.91 / 12 (mensuel amorti)
    assert line.one_time_total == 0
    assert quote.monthly_discounted_total == 629.33
    assert quote.period_discounted_total == 7551.91   # 12 mois = 1 an (et NON 90 622,92)
    assert quote.one_time_total == 0
    assert line.engagement_months == 12
    assert line.engagement_total == 7551.91           # total sur l'engagement = prix annuel


def test_quote_multiyear_license_uses_engagement_years_not_sku(monkeypatch):
    # multiyear : durée = engagement (années) × 12, jamais le suffixe SKU. 3 ans -> 36 mois.
    monkeypatch.setattr(quote_mod, "find_license_item", lambda sku: _license_item("multiyear", 3, 14706.34))
    request = QuoteRequest(period_months=36, lines=[QuoteLineRequest(sku="LIC-TERM-TEST", source="license")])

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.term_months == 36
    assert line.monthly_total == 408.51               # 14706.34 / 36
    assert quote.period_discounted_total == 14706.34  # 36 mois = le bundle (et NON 529 428)
    assert quote.one_time_total == 0


def test_quote_perpetual_license_is_one_time_invariant_to_projection(monkeypatch):
    # Perpétuelle (term None, engagement 'Perpetuel') : coût ponctuel, JAMAIS × projection.
    monkeypatch.setattr(quote_mod, "find_license_item", lambda sku: _license_item(None, "Perpetuel", 161.48))
    lines = [QuoteLineRequest(sku="LIC-TERM-TEST", source="license", quantity=4)]

    q12 = calculate_quote(QuoteRequest(period_months=12, lines=lines))
    q60 = calculate_quote(QuoteRequest(period_months=60, lines=lines))
    line = q12.lines[0]

    assert line.recurring is False
    assert line.monthly_total == 0
    assert line.one_time_total == 645.92              # 161.48 × 4
    assert q12.monthly_discounted_total == 0
    assert q12.one_time_total == 645.92
    assert q12.period_discounted_total == 645.92      # compté une seule fois
    assert q60.period_discounted_total == 645.92      # INVARIANT à la projection
    assert q12.total_on_engagement == 645.92


def test_quote_multiyear_5y_not_counted_as_monthly(monkeypatch):
    # Anti-régression directe du bug : le mensuel d'un pluriannuel != son prix de bundle.
    monkeypatch.setattr(quote_mod, "find_license_item", lambda sku: _license_item("multiyear", 5, 24000.0))
    request = QuoteRequest(period_months=60, lines=[QuoteLineRequest(sku="LIC-TERM-TEST", source="license")])

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.term_months == 60                     # 5 ans
    assert line.monthly_total == 400.0                # 24000 / 60, surtout PAS 24000
    assert quote.monthly_discounted_total != 24000.0
    assert quote.period_discounted_total == 24000.0   # 60 mois = le bundle 5 ans


def test_quote_partner_discount_applies_on_annual_monthly_equivalent(monkeypatch):
    # En mode partenaire, la remise catalogue s'applique au prix natif puis est amortie.
    item = _license_item("annual", 1, 1200.0)
    item["pricing"]["discounts"] = {"standard": 25}
    monkeypatch.setattr(quote_mod, "find_license_item", lambda sku: item)
    request = QuoteRequest(
        period_months=12, partner=True, lines=[QuoteLineRequest(sku="LIC-TERM-TEST", source="license")]
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.standard_discount_percent == 25
    assert line.discounted_unit_price == 900.0        # 1200 × 0.75 (prix natif remisé)
    assert line.monthly_total == 75.0                 # 900 / 12
    assert quote.period_discounted_total == 900.0     # 12 mois = 1 an remisé
    assert quote.savings_total == 300.0               # (1200 − 900) sur l'année
