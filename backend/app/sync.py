from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from shutil import copy2
from typing import Any

import yaml

from .catalog import load_catalog_items
from .config import catalogs_dir, licences_file, source_catalogs_dir, source_licences_dir
from .licenses import load_license_items


RUNTIME_EXTENSIONS = {".json", ".md", ".yaml", ".yml"}
IGNORED_DIRS = {"SOURCE", "TRAIN", "__pycache__"}


@dataclass(frozen=True)
class RuntimeFile:
    group: str
    relative_path: Path
    source_path: Path
    target_path: Path

    @property
    def key(self) -> str:
        return f"{self.group}/{self.relative_path.as_posix()}"


def _sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _iter_runtime_files(source_root: Path, target_root: Path, group: str) -> list[RuntimeFile]:
    if not source_root.exists():
        return []

    files: list[RuntimeFile] = []
    for path in sorted(source_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(source_root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        if path.suffix.lower() not in RUNTIME_EXTENSIONS:
            continue
        files.append(
            RuntimeFile(
                group=group,
                relative_path=relative,
                source_path=path,
                target_path=target_root / relative,
            )
        )
    return files


def _catalog_runtime_files() -> list[RuntimeFile]:
    return _iter_runtime_files(source_catalogs_dir(), catalogs_dir(), "CATALOGS")


def _licence_runtime_files() -> list[RuntimeFile]:
    return _iter_runtime_files(source_licences_dir(), licences_file().parent, "LICENCES")


def _runtime_files() -> list[RuntimeFile]:
    return _catalog_runtime_files() + _licence_runtime_files()


def _target_files_for_group(source_files: list[RuntimeFile], target_root: Path, group: str) -> dict[str, Path]:
    target_files: dict[str, Path] = {}
    if not target_root.exists():
        return target_files

    source_relative = {item.relative_path.as_posix() for item in source_files if item.group == group}
    for path in sorted(target_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(target_root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        if path.suffix.lower() not in RUNTIME_EXTENSIONS:
            continue
        if relative.as_posix() not in source_relative:
            target_files[f"{group}/{relative.as_posix()}"] = path
    return target_files


def _validate_catalogs() -> dict[str, Any]:
    source_root = source_catalogs_dir()
    files = [item.source_path for item in _catalog_runtime_files() if item.source_path.suffix.lower() in {".yaml", ".yml"}]
    product_count = 0
    invalid_products: list[str] = []

    if not source_root.exists():
        raise FileNotFoundError(f"Catalogue source introuvable: {source_root}")

    for path in files:
        data = _load_yaml(path) or {}
        if not isinstance(data, dict):
            raise ValueError(f"YAML catalogue invalide: {path}")

        if path.parts[-2] not in {"cloud", "services"}:
            continue

        raw_items = data.get("items") or data.get("products")
        if raw_items is None and isinstance(data.get("catalog"), dict):
            raw_items = data["catalog"].get("products")
        if raw_items is None:
            raw_items = []
        if not isinstance(raw_items, list):
            raise ValueError(f"Liste produits invalide: {path}")

        for index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                invalid_products.append(f"{path}:{index}")
                continue
            if not item.get("sku") or not (item.get("name") or item.get("title")):
                invalid_products.append(f"{path}:{index}")
                continue
            product_count += 1

    if invalid_products:
        sample = ", ".join(invalid_products[:5])
        raise ValueError(f"Produits catalogue invalides: {sample}")

    return {"files": len(files), "items": product_count}


def _validate_licences() -> dict[str, Any]:
    source_root = source_licences_dir()
    source_file = source_root / "licences.yaml"
    if not source_file.exists():
        raise FileNotFoundError(f"Fichier licences source introuvable: {source_file}")

    data = _load_yaml(source_file) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML licences invalide: {source_file}")

    raw_items = data.get("items") or data.get("licenses") or []
    if not isinstance(raw_items, list):
        raise ValueError(f"Liste licences invalide: {source_file}")

    invalid = [
        str(index)
        for index, item in enumerate(raw_items)
        if not isinstance(item, dict) or not item.get("sku") or not item.get("name")
    ]
    if invalid:
        raise ValueError(f"Licences invalides: {', '.join(invalid[:5])}")

    return {"files": len(_licence_runtime_files()), "items": len(raw_items)}


def _manifest(source_files: list[RuntimeFile]) -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    for item in source_files:
        source_hash = _sha256(item.source_path)
        target_hash = _sha256(item.target_path) if item.target_path.exists() else None
        manifest[item.key] = {
            "source": str(item.source_path),
            "target": str(item.target_path),
            "source_checksum": source_hash,
            "target_checksum": target_hash,
            "source_mtime": item.source_path.stat().st_mtime,
            "target_mtime": item.target_path.stat().st_mtime if item.target_path.exists() else None,
        }
    return manifest


def sync_status() -> dict[str, Any]:
    source_files = _runtime_files()
    manifest = _manifest(source_files)
    target_extra = {
        **_target_files_for_group(source_files, catalogs_dir(), "CATALOGS"),
        **_target_files_for_group(source_files, licences_file().parent, "LICENCES"),
    }

    new_files = [key for key, meta in manifest.items() if meta["target_checksum"] is None]
    modified_files = [
        key
        for key, meta in manifest.items()
        if meta["target_checksum"] is not None and meta["target_checksum"] != meta["source_checksum"]
    ]
    removed_files = sorted(target_extra)
    needs_sync = bool(new_files or modified_files or removed_files)

    try:
        validation = {"catalogs": _validate_catalogs(), "licences": _validate_licences()}
        validation_status = "success"
        validation_error = None
    except Exception as exc:
        validation = None
        validation_status = "error"
        validation_error = str(exc)
        needs_sync = True

    return {
        "status": "success",
        "source": {
            "catalogs_dir": str(source_catalogs_dir()),
            "licences_dir": str(source_licences_dir()),
        },
        "target": {
            "catalogs_dir": str(catalogs_dir()),
            "licences_file": str(licences_file()),
        },
        "is_synchronized": not needs_sync and validation_status == "success",
        "needs_sync": needs_sync,
        "validation": validation,
        "validation_status": validation_status,
        "validation_error": validation_error,
        "file_count": len(manifest),
        "delta": {
            "new": sorted(new_files),
            "modified": sorted(modified_files),
            "removed": removed_files,
            "new_count": len(new_files),
            "modified_count": len(modified_files),
            "removed_count": len(removed_files),
        },
    }


def sync_summary() -> dict[str, Any]:
    source_files = _runtime_files()
    missing_targets = [item.key for item in source_files if not item.target_path.exists()]
    changed_targets = [
        item.key
        for item in source_files
        if item.target_path.exists()
        and (
            item.source_path.stat().st_size != item.target_path.stat().st_size
            or item.source_path.stat().st_mtime > item.target_path.stat().st_mtime + 1
        )
    ]
    needs_sync = bool(missing_targets or changed_targets)

    return {
        "is_synchronized": not needs_sync,
        "needs_sync": needs_sync,
        "source_available": source_catalogs_dir().exists() and (source_licences_dir() / "licences.yaml").exists(),
        "file_count": len(source_files),
        "delta": {
            "new_count": len(missing_targets),
            "modified_count": len(changed_targets),
            "removed_count": None,
        },
        "status_endpoint": "/api/sync/status",
    }


def sync_catalog() -> dict[str, Any]:
    validation = {"catalogs": _validate_catalogs(), "licences": _validate_licences()}
    before = sync_status()
    source_files = _runtime_files()
    target_extra = {
        **_target_files_for_group(source_files, catalogs_dir(), "CATALOGS"),
        **_target_files_for_group(source_files, licences_file().parent, "LICENCES"),
    }

    for item in source_files:
        item.target_path.parent.mkdir(parents=True, exist_ok=True)
        copy2(item.source_path, item.target_path)

    for path in target_extra.values():
        path.unlink()

    load_catalog_items.cache_clear()
    load_license_items.cache_clear()
    after = sync_status()

    return {
        "status": "success",
        "message": "Catalogue et licences synchronises depuis QuoteFlow.",
        "validation": validation,
        "before": before,
        "after": after,
        "catalog_items": len(load_catalog_items()),
        "license_items": len(load_license_items()),
    }
