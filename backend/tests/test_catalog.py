"""Tests du chemin de SERVICE du catalogue (catalog.enrich_pricing).

`enrich_pricing` alimente `pricing_summary`, qui est la source du prix unitaire
réellement consommée par le calcul de devis et l'affichage. C'est le chemin
observable (contrairement à la colonne BDD `public_price`, recalculée ici).
"""
import pytest

from app.catalog import enrich_pricing


def test_enrich_pricing_preserves_zero_public_price():
    """#3 (chemin servi) — un `public_price` de 0 (offre gratuite) ne doit pas
    « tomber » sur un autre champ de prix. L'ancien `or`-chain renvoyait 99."""
    out = enrich_pricing({"unit": "VPC", "pricing": {"public_price": 0.0, "unit_price": 99}})
    assert out["pricing_summary"]["public_price"] == 0.0  # PAS 99


def test_enrich_pricing_falls_through_only_when_field_absent():
    """Le repli sur un autre champ ne joue que si `public_price` est ABSENT."""
    out = enrich_pricing({"unit": "vm", "pricing": {"unit_price": 35}})
    assert out["pricing_summary"]["public_price"] == pytest.approx(35.0)


@pytest.mark.parametrize(
    "pricing, expected",
    [
        ({"public_price": 10}, 10.0),
        ({"unit_price": 20}, 20.0),
        ({"price": 30}, 30.0),
        ({"monthly_price": 40}, 40.0),
    ],
)
def test_enrich_pricing_fallback_covers_each_field(pricing, expected):
    """Chaque champ de prix sert de repli quand les précédents sont absents."""
    out = enrich_pricing({"pricing": pricing})
    assert out["pricing_summary"]["public_price"] == pytest.approx(expected)


def test_enrich_pricing_precedence_when_several_fields_present():
    """Précédence stricte : public_price > unit_price > price > monthly_price."""
    full = {"public_price": 1, "unit_price": 2, "price": 3, "monthly_price": 4}
    assert enrich_pricing({"pricing": full})["pricing_summary"]["public_price"] == pytest.approx(1.0)
    del full["public_price"]
    assert enrich_pricing({"pricing": full})["pricing_summary"]["public_price"] == pytest.approx(2.0)
    del full["unit_price"]
    assert enrich_pricing({"pricing": full})["pricing_summary"]["public_price"] == pytest.approx(3.0)
    del full["price"]
    assert enrich_pricing({"pricing": full})["pricing_summary"]["public_price"] == pytest.approx(4.0)


def test_enrich_pricing_applies_standard_discount():
    """Remise standard catalogue : public 100, remise 25 % -> prix remisé 75."""
    summary = enrich_pricing(
        {"pricing": {"public_price": 100, "discounts": {"standard": 25}}}
    )["pricing_summary"]
    assert summary["public_price"] == pytest.approx(100.0)
    assert summary["discount_percent"] == pytest.approx(25.0)
    assert summary["discounted_price"] == pytest.approx(75.0)


@pytest.mark.parametrize(
    "pricing",
    [
        {"public_price": 0.0, "unit_price": 99},  # offre gratuite (prix 0)
        {"public_price": 42.5},
        {"unit_price": 12},
        {"price": 30},
        {"monthly_price": 40},
    ],
)
def test_served_price_matches_ingested_price(pricing):
    """Contrat « prix ingéré (BDD) == prix servi (devis) » pour un prix numérique
    présent (y compris 0). `normalize_product_item` et `enrich_pricing` doivent
    résoudre le MÊME `public_price`."""
    from app.ingest import normalize_product_item

    ingested = normalize_product_item(
        {"name": "X", "pricing": pricing},
        catalog="cloud",
        default_category="compute",
        type_fallback="vm",
        source_file="cloud/x.yaml",
        catalog_version="1",
    )
    served = enrich_pricing({"pricing": pricing})["pricing_summary"]["public_price"]
    assert served == pytest.approx(ingested["public_price"])


def test_non_numeric_price_divergence_is_documented():
    """Cas limite (hors données réelles) : prix présent mais non numérique.

    Divergence ASSUMÉE et figée : `ingest` stocke `None` (prix inconnu), `catalog`
    sert `0.0` pour ne jamais casser le calcul aval de `discounted_price`. Ce test
    rend toute évolution de ce contrat consciente."""
    from app.ingest import normalize_product_item

    pricing = {"public_price": "n/a"}
    ingested = normalize_product_item(
        {"name": "X", "pricing": pricing},
        catalog="cloud",
        default_category="c",
        type_fallback="t",
        source_file="f",
        catalog_version="1",
    )
    served = enrich_pricing({"pricing": pricing})["pricing_summary"]["public_price"]
    assert ingested["public_price"] is None  # ingest : prix inconnu
    assert served == 0.0  # catalog : repli robuste
