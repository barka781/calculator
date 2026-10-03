"""Compléments catalogue locaux (CATALOGS_LOCAL) : chargés en plus du catalogue
QuoteFlow, jamais touchés par la synchro, et toujours supplantés par QuoteFlow à
SKU égal. Couvre aussi l'offre VM Instances livrée dans ce dossier."""

import os
from pathlib import Path

import pytest

from app import config
from app.catalog import find_catalog_item, load_catalog_items
from app.ingest import _dedupe, with_local_products
from app.licenses import load_license_items
from app.models import QuoteRequest
from app.quote import calculate_quote
from app.sync import sync_catalog


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _reset_caches() -> None:
    config.data_root.cache_clear()
    config.quoteflow_root.cache_clear()
    load_catalog_items.cache_clear()
    load_license_items.cache_clear()


@pytest.fixture(autouse=True)
def yaml_source(monkeypatch):
    # Lecture directe des YAML (pas de BDD) pour observer le répertoire de données.
    monkeypatch.setenv("CALCULATOR_SOURCE", "yaml")
    _reset_caches()
    yield
    monkeypatch.undo()
    _reset_caches()


def _product_yaml(sku: str, price: float) -> str:
    return f"""
metadata:
  category: compute
items:
  - sku: {sku}
    name: Produit {sku}
    unit: Lame
    pricing:
      public_price: {price}
"""


def test_local_catalog_survives_sync_and_quoteflow_wins(tmp_path, monkeypatch):
    source = tmp_path / "quoteflow"
    target = tmp_path / "calculator-data"
    monkeypatch.setenv("CALCULATOR_QUOTEFLOW_ROOT", str(source))
    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(target))
    _reset_caches()

    _write(source / "CATALOGS/cloud/compute.yaml", _product_yaml("SHARED", 42))
    _write(source / "LICENCES/licences.yaml", "items: []\n")
    # Complément local : un SKU propre + un SKU que QuoteFlow publie aussi.
    _write(
        target / "CATALOGS_LOCAL/cloud/extra.yaml",
        _product_yaml("SHARED", 99) + """
  - sku: LOCAL-ONLY
    name: Produit local
    unit: vCPU
    pricing:
      public_price: 7
""",
    )
    # Fichier obsolète DANS le périmètre synchronisé : la synchro doit le supprimer.
    _write(target / "CATALOGS/cloud/stale.yaml", _product_yaml("STALE", 1))

    assert sync_catalog(refresh=False)["status"] == "success"

    assert not (target / "CATALOGS/cloud/stale.yaml").exists()
    assert (target / "CATALOGS_LOCAL/cloud/extra.yaml").exists()

    load_catalog_items.cache_clear()
    prices = {i["sku"]: i["pricing_summary"]["public_price"] for i in load_catalog_items()}
    assert prices["SHARED"] == 42  # QuoteFlow prévaut sur le complément local
    assert prices["LOCAL-ONLY"] == 7
    assert "STALE" not in prices


def test_ingest_merge_keeps_quoteflow_on_duplicate_sku(tmp_path, monkeypatch):
    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(tmp_path))
    _reset_caches()
    _write(
        tmp_path / "CATALOGS_LOCAL/cloud/extra.yaml",
        _product_yaml("SHARED", 99) + """
  - sku: LOCAL-ONLY
    name: Produit local
    unit: vCPU
    pricing:
      public_price: 7
""",
    )
    upstream = [{"sku": "SHARED", "public_price": 42.0}]

    merged = {row["sku"]: row for row in _dedupe(with_local_products(upstream))}

    assert merged["SHARED"]["public_price"] == 42.0
    assert merged["LOCAL-ONLY"]["public_price"] == 7.0


def test_shipped_vm_instances_are_priced_by_the_quote_engine(monkeypatch):
    # Données réellement livrées (backend/data) : l'offre est chargée, marquée
    # provisoire et SecNumCloud « en cours », et le moteur de devis la valorise.
    monkeypatch.delenv("CALCULATOR_DATA_DIR", raising=False)
    monkeypatch.setenv("CALCULATOR_VIEW_PARTNER", "no")
    _reset_caches()

    vcpu = find_catalog_item("csp:fr1:iaas:vmi:gp:vcpu:v1")
    ram = find_catalog_item("csp:fr1:iaas:vmi:gp:ram:v1")
    assert vcpu and ram
    assert vcpu["metadata"]["provisional"] is True
    assert vcpu["metadata"]["snc"] == "EN COURS"

    quote = calculate_quote(QuoteRequest(lines=[
        {"sku": "csp:fr1:iaas:vmi:gp:vcpu:v1", "quantity": 4},
        {"sku": "csp:fr1:iaas:vmi:gp:ram:v1", "quantity": 16},
    ]))
    # Gabarit 4 vCPU / 16 Gio en General Purpose : 4 × 13,98 + 16 × 3,58.
    assert quote.monthly_discounted_total == pytest.approx(113.20)
    assert quote.monthly_public_total == pytest.approx(113.20)
