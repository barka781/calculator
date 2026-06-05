from fastapi.testclient import TestClient

from app.export import quote_to_html, quote_to_pdf, quote_to_xlsx, render_quote
from app.main import app
from app.models import QuoteLineRequest, QuoteRequest
from app.quote import calculate_quote

client = TestClient(app)

# Deux familles différentes (Storage + Network) pour valider le regroupement par catégorie.
SAMPLE = QuoteRequest(
    period_months=36,
    discount_percent=10,
    lines=[
        QuoteLineRequest(sku="csp:fr1:iaas:storage:bloc:medium:v1", quantity=1024),
        QuoteLineRequest(sku="csp:fr1:network:epl:1g:v1", quantity=1),
    ],
)


def _quote():
    return calculate_quote(SAMPLE)


def test_xlsx_is_valid_zip_and_non_empty():
    data = quote_to_xlsx(_quote(), {"project": "Test", "date": "2026-06-05"})
    assert len(data) > 1000
    assert data[:2] == b"PK"  # un .xlsx est une archive ZIP


def test_pdf_has_magic_header():
    data = quote_to_pdf(_quote(), {"project": "Test"})
    assert len(data) > 1000
    assert data[:4] == b"%PDF"


def test_html_contains_totals_and_groups():
    out = quote_to_html(_quote(), {"project": "Projet Démo"})
    assert "Projet Démo" in out
    assert "Total mensuel remisé" in out
    assert "dont remise catalogue" in out
    # Regroupement par catégorie présent.
    assert "Sous-total" in out


def test_render_quote_rejects_unknown_format():
    import pytest

    with pytest.raises(ValueError):
        render_quote(_quote(), "docx")


def test_export_endpoint_each_format():
    payload = SAMPLE.model_dump()
    payload["project"] = "Migration ERP 2026"

    for fmt, magic, ctype in [
        ("xlsx", b"PK", "spreadsheetml"),
        ("pdf", b"%PDF", "application/pdf"),
        ("html", b"<!doctype html", "text/html"),
    ]:
        resp = client.post(f"/api/quote/export?format={fmt}", json=payload)
        assert resp.status_code == 200, resp.text
        assert resp.content[: len(magic)] == magic
        assert ctype in resp.headers["content-type"]
        assert "attachment" in resp.headers["content-disposition"]
        assert "Migration-ERP-2026" in resp.headers["content-disposition"]


def test_export_endpoint_rejects_empty_quote():
    resp = client.post("/api/quote/export?format=pdf", json={"lines": []})
    assert resp.status_code == 422
