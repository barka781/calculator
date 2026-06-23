from app.models import QuoteLineRequest, QuoteRequest
from app.quote import calculate_quote


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
