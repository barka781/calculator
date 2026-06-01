from app.models import QuoteLineRequest, QuoteRequest
from app.quote import calculate_quote


def test_quote_catalog_line():
    request = QuoteRequest(
        period_months=12,
        discount_percent=25,
        lines=[
            QuoteLineRequest(
                sku="csp:fr1:iaas:storage:bloc:medium:v1",
                quantity=1024,
            )
        ],
    )

    quote = calculate_quote(request)

    assert quote.status == "success"
    assert quote.lines[0].monthly_total == 58.06
    assert quote.period_discounted_total == 696.73
