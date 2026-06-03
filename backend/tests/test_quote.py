from app.models import QuoteLineRequest, QuoteRequest
from app.quote import calculate_quote


def test_quote_applies_standard_discount_automatically():
    # csp:fr1:iaas:storage:bloc:medium:v1 : public 0.0756, discounts.standard 25%, engagement "1 mois".
    # Sans remise commerciale supplémentaire (discount_percent=0), le devis doit déjà appliquer
    # la remise standard catalogue (comme QuoteFlow), pas le plein tarif.
    request = QuoteRequest(
        period_months=12,
        discount_percent=0,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert quote.status == "success"
    assert line.standard_discount_percent == 25
    assert line.discounted_unit_price == 0.0567  # 0.0756 * 0.75
    assert line.monthly_total == 58.06
    assert line.engagement_months == 1
    assert line.engagement_total == 58.06
    assert quote.period_discounted_total == 696.73


def test_quote_extra_discount_stacks_on_standard():
    # Une remise commerciale supplémentaire de 25% s'empile sur la remise standard de 25%.
    request = QuoteRequest(
        period_months=12,
        discount_percent=25,
        lines=[QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024)],
    )

    quote = calculate_quote(request)
    # 0.0756 * 0.75 (standard) * 0.75 (commerciale) = 0.042525
    assert quote.lines[0].discounted_unit_price == 0.0425
    assert quote.lines[0].monthly_total == 43.55  # 0.042525 * 1024 = 43.5456


def test_quote_multi_month_engagement():
    # csp:fr1:network:epl:1g:v1 : public 1300.80, standard 25%, engagement "36 mois".
    request = QuoteRequest(
        discount_percent=0,
        lines=[QuoteLineRequest(sku="csp:fr1:network:epl:1g:v1", quantity=1)],
    )

    quote = calculate_quote(request)
    line = quote.lines[0]

    assert line.discounted_unit_price == 975.60  # 1300.80 * 0.75
    assert line.monthly_total == 975.60
    assert line.engagement_months == 36
    assert line.engagement_total == 35121.60  # 975.60 * 36
    assert quote.total_on_engagement == 35121.60
