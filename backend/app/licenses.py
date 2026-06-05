from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional, Tuple
import logging

import yaml

from .config import data_source, licences_file


logger = logging.getLogger(__name__)


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ".").replace(" €", "").replace("€", "").strip())
    except ValueError:
        return None


def _sort_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: (str(item.get("vendor") or ""), str(item.get("name") or "")))


def _load_items_from_yaml() -> list[dict[str, Any]]:
    path = licences_file()
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    raw_items = data.get("items") or data.get("licenses") or []
    if not isinstance(raw_items, list):
        return []

    items = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        pricing = item.get("pricing") or {}
        items.append(
            {
                "sku": item.get("sku"),
                "name": item.get("name") or "Sans nom",
                "description": item.get("description"),
                "vendor": item.get("vendor"),
                "edition": item.get("edition"),
                "category": item.get("category") or "Licence",
                "type": item.get("type"),
                "unit": item.get("unit"),
                "pricing": pricing,
                "price": _safe_float(pricing.get("public_price")),
                "metadata": item.get("metadata") or {},
            }
        )

    return _sort_items(items)


def _row_to_item(row: Any) -> dict[str, Any]:
    """Reconstruit le dict licence au format identique au chargement YAML."""
    pricing = row.pricing or {}
    return {
        "sku": row.sku,
        "name": row.name or "Sans nom",
        "description": row.description,
        "vendor": row.vendor,
        "edition": row.edition,
        "category": row.category or "Licence",
        "type": row.type,
        "unit": row.unit,
        "pricing": pricing,
        "price": _safe_float(pricing.get("public_price")),
        "metadata": row.item_metadata or {},
    }


def _load_items_from_db() -> list[dict[str, Any]]:
    from sqlalchemy import select

    from .db import SessionLocal
    from .db_models import License

    with SessionLocal() as session:
        rows = session.execute(select(License)).scalars().all()
    return _sort_items([_row_to_item(row) for row in rows])


@lru_cache(maxsize=1)
def load_license_items() -> list[dict[str, Any]]:
    if data_source() != "db":
        return _load_items_from_yaml()
    try:
        items = _load_items_from_db()
    except Exception as exc:  # BDD injoignable -> repli résilient sur YAML
        logger.warning("Lecture licences BDD impossible, repli YAML: %s", exc)
        items = []
    return items or _load_items_from_yaml()


def find_license_item(sku: str) -> Optional[dict[str, Any]]:
    needle = sku.strip().lower()
    return next((item for item in load_license_items() if str(item.get("sku") or "").lower() == needle), None)


def search_licenses(
    query: Optional[str] = None,
    vendor: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[list[dict[str, Any]], int]:
    candidates = load_license_items()
    if vendor:
        candidates = [item for item in candidates if vendor.lower() in str(item.get("vendor") or "").lower()]
    if query:
        needle = query.strip().lower()
        candidates = [
            item
            for item in candidates
            if needle
            in " ".join(
                str(item.get(key) or "")
                for key in ("sku", "name", "description", "vendor", "edition", "unit")
            ).lower()
        ]
    total = len(candidates)
    return candidates[skip : skip + limit], total
