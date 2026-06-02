from pathlib import Path

from app import config
from app.catalog import load_catalog_items
from app.licenses import load_license_items
from app.main import get_sync_status
from app.sync import sync_catalog, sync_status


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _reset_caches() -> None:
    config.data_root.cache_clear()
    config.quoteflow_root.cache_clear()
    load_catalog_items.cache_clear()
    load_license_items.cache_clear()


def test_sync_catalog_from_local_quoteflow_source(tmp_path, monkeypatch):
    source = tmp_path / "quoteflow"
    target = tmp_path / "calculator-data"
    monkeypatch.setenv("CALCULATOR_QUOTEFLOW_ROOT", str(source))
    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(target))
    _reset_caches()

    _write(
        source / "CATALOGS/cloud/compute.yaml",
        """
metadata:
  category: cloud
items:
  - sku: csp:test:compute:v1
    name: Test Compute
    unit: Lame
    pricing:
      public_price: 42
""",
    )
    _write(
        source / "LICENCES/licences.yaml",
        """
items:
  - sku: LIC-001
    name: Test Licence
    vendor: Test
    unit: Licence
    pricing:
      public_price: 12
""",
    )
    _write(source / "LICENCES/templates/licences_schema.json", "{}")
    _write(source / "LICENCES/SOURCE/raw.csv", "ignored")

    before = sync_status()
    assert before["needs_sync"] is True
    assert before["delta"]["new_count"] == 3

    result = sync_catalog()
    assert result["status"] == "success"
    assert result["catalog_items"] == 1
    assert result["license_items"] == 1

    assert (target / "CATALOGS/cloud/compute.yaml").exists()
    assert (target / "LICENCES/licences.yaml").exists()
    assert not (target / "LICENCES/SOURCE/raw.csv").exists()

    after = sync_status()
    assert after["is_synchronized"] is True
    assert after["delta"]["new_count"] == 0
    assert after["delta"]["modified_count"] == 0

    assert get_sync_status()["is_synchronized"] is True
