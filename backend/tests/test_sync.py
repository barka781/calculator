import os
import shutil
import subprocess
from pathlib import Path

import pytest

from app import config
from app.catalog import load_catalog_items
from app.licenses import load_license_items
from app.main import get_sync_status
from app.sync import _redact_url, sync_catalog, sync_status


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _reset_caches() -> None:
    config.data_root.cache_clear()
    config.quoteflow_root.cache_clear()
    config.live_git_cache_dir.cache_clear()
    load_catalog_items.cache_clear()
    load_license_items.cache_clear()


@pytest.fixture(autouse=True)
def reset_caches_around_test():
    original_env = {
        "CALCULATOR_DATA_DIR": os.environ.get("CALCULATOR_DATA_DIR"),
        "CALCULATOR_QUOTEFLOW_ROOT": os.environ.get("CALCULATOR_QUOTEFLOW_ROOT"),
        "CALCULATOR_SOURCE_CATALOGS_DIR": os.environ.get("CALCULATOR_SOURCE_CATALOGS_DIR"),
        "CALCULATOR_SOURCE_LICENCES_DIR": os.environ.get("CALCULATOR_SOURCE_LICENCES_DIR"),
        "CALCULATOR_SOURCE": os.environ.get("CALCULATOR_SOURCE"),
        "CALCULATOR_LIVE_GIT_URL": os.environ.get("CALCULATOR_LIVE_GIT_URL"),
        "CALCULATOR_LIVE_GIT_REF": os.environ.get("CALCULATOR_LIVE_GIT_REF"),
        "CALCULATOR_LIVE_GIT_CACHE_DIR": os.environ.get("CALCULATOR_LIVE_GIT_CACHE_DIR"),
    }
    # La synchro porte sur les fichiers YAML : on épingle la source en lecture
    # sur YAML pour que les comptages reflètent le répertoire de données synchronisé.
    os.environ["CALCULATOR_SOURCE"] = "yaml"
    _reset_caches()
    yield
    for key, value in original_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    _reset_caches()


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
    assert result["last_sync"]["kind"] == "local_quoteflow"
    assert result["last_sync"]["source"]["git"]["available"] is False

    assert (target / "CATALOGS/cloud/compute.yaml").exists()
    assert (target / "LICENCES/licences.yaml").exists()
    assert not (target / "LICENCES/SOURCE/raw.csv").exists()
    assert (target / "_sync_manifest.json").exists()

    after = sync_status()
    assert after["is_synchronized"] is True
    assert after["source"]["kind"] == "local_quoteflow"
    assert after["source"]["git"]["available"] is False
    assert after["last_sync"]["synced_at"] == result["last_sync"]["synced_at"]
    assert after["delta"]["new_count"] == 0
    assert after["delta"]["modified_count"] == 0
    assert after["delta"]["removed_count"] == 0

    assert get_sync_status()["is_synchronized"] is True

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
      public_price: 43
""",
    )
    _write(target / "LICENCES/obsolete.md", "obsolete")

    changed = sync_status()
    assert changed["needs_sync"] is True
    assert changed["delta"]["modified"] == ["CATALOGS/cloud/compute.yaml"]
    assert changed["delta"]["removed"] == ["LICENCES/obsolete.md"]


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _git_commit(repo: Path, message: str) -> None:
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "user.name=Test",
            "commit",
            "-m",
            message,
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def test_live_git_sync_uses_managed_cache(tmp_path, monkeypatch):
    repo = tmp_path / "quoteflow-repo"
    target = tmp_path / "calculator-data"
    cache = tmp_path / "live-cache"

    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, capture_output=True, text=True)
    _write(
        repo / "CATALOGS/cloud/compute.yaml",
        """
metadata:
  category: cloud
items:
  - sku: csp:test:live:v1
    name: Live Compute
    unit: Lame
    pricing:
      public_price: 99
""",
    )
    _write(
        repo / "LICENCES/licences.yaml",
        """
items:
  - sku: LIVE-LIC-001
    name: Live Licence
    vendor: Test
    unit: Licence
    pricing:
      public_price: 12
""",
    )
    _git(repo, "add", "CATALOGS", "LICENCES")
    _git_commit(repo, "initial live data")

    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(target))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_URL", str(repo))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_REF", "main")
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_CACHE_DIR", str(cache))
    _reset_caches()

    result = sync_catalog()

    assert result["status"] == "success"
    assert result["refresh"]["status"] == "success"
    assert result["refresh"]["action"] == "clone"
    assert result["last_sync"]["kind"] == "live_git"
    assert result["last_sync"]["source"]["kind"] == "live_git"
    assert result["catalog_items"] == 1
    assert result["license_items"] == 1
    assert (cache / ".git").exists()
    assert (target / "CATALOGS/cloud/compute.yaml").exists()
    assert (target / "LICENCES/licences.yaml").exists()


def _compute_yaml(price: int) -> str:
    return f"""
metadata:
  category: cloud
items:
  - sku: csp:test:live:v1
    name: Live Compute
    unit: Lame
    pricing:
      public_price: {price}
"""


def _seed_live_repo(repo: Path) -> None:
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, capture_output=True, text=True)
    _write(repo / "CATALOGS/cloud/compute.yaml", _compute_yaml(99))
    _write(
        repo / "LICENCES/licences.yaml",
        """
items:
  - sku: LIVE-LIC-001
    name: Live Licence
    vendor: Test
    unit: Licence
    pricing:
      public_price: 12
""",
    )
    _git(repo, "add", "CATALOGS", "LICENCES")
    _git_commit(repo, "initial live data")


def test_live_git_refresh_is_incremental(tmp_path, monkeypatch):
    """Un 2e commit sur la source live est récupéré via fetch (pas re-clone)."""
    repo = tmp_path / "quoteflow-repo"
    target = tmp_path / "calculator-data"
    cache = tmp_path / "live-cache"
    _seed_live_repo(repo)

    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(target))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_URL", str(repo))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_REF", "main")
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_CACHE_DIR", str(cache))
    _reset_caches()

    first = sync_catalog()
    assert first["refresh"]["action"] == "clone"
    assert "99" in (target / "CATALOGS/cloud/compute.yaml").read_text(encoding="utf-8")

    # Nouvelle version du catalogue côté source.
    _write(repo / "CATALOGS/cloud/compute.yaml", _compute_yaml(111))
    _git(repo, "add", "CATALOGS")
    _git_commit(repo, "bump compute price")

    second = sync_catalog()
    assert second["status"] == "success"
    assert second["refresh"]["status"] == "success"
    assert second["refresh"]["action"] == "fetch"
    assert second["catalog_items"] == 1
    assert "111" in (target / "CATALOGS/cloud/compute.yaml").read_text(encoding="utf-8")


def test_live_git_refresh_failure_keeps_cache(tmp_path, monkeypatch):
    """Si la source live devient injoignable, on garde le cache (statut stale, pas d'exception)."""
    repo = tmp_path / "quoteflow-repo"
    target = tmp_path / "calculator-data"
    cache = tmp_path / "live-cache"
    _seed_live_repo(repo)

    monkeypatch.setenv("CALCULATOR_DATA_DIR", str(target))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_URL", str(repo))
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_REF", "main")
    monkeypatch.setenv("CALCULATOR_LIVE_GIT_CACHE_DIR", str(cache))
    _reset_caches()

    first = sync_catalog()
    assert first["refresh"]["status"] == "success"
    assert first["catalog_items"] == 1

    # La source disparaît (réseau coupé / dépôt déplacé) : le fetch va échouer.
    shutil.rmtree(repo)

    second = sync_catalog()
    assert second["status"] == "success"  # la synchro globale tient
    assert second["refresh"]["status"] == "stale"
    assert second["refresh"]["error"]
    assert second["catalog_items"] == 1  # données précédentes conservées
    assert (cache / ".git").exists()
    assert (target / "CATALOGS/cloud/compute.yaml").exists()


def test_redact_url_masks_credentials():
    assert _redact_url("https://user:token@gitlab.internal/quoteflow.git") == (
        "https://[redacted]@gitlab.internal/quoteflow.git"
    )
    assert _redact_url("http://x:y@host/r") == "http://[redacted]@host/r"
    # Rien à masquer : URL sans credentials et valeurs vides inchangées.
    assert _redact_url("https://gitlab.internal/quoteflow.git") == "https://gitlab.internal/quoteflow.git"
    assert _redact_url(None) is None
    assert _redact_url("") == ""
