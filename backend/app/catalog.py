from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Optional, Tuple
import re

import yaml

from .config import catalogs_dir


STOPWORDS_FR = {
    "un",
    "une",
    "des",
    "du",
    "de",
    "d",
    "le",
    "la",
    "les",
    "et",
    "ou",
    "au",
    "aux",
    "en",
    "pour",
    "avec",
    "sans",
    "sur",
    "par",
    "dans",
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ".").replace(" EUR", "").replace("€", "").strip())
    except ValueError:
        return default


def _title(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").title()


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _extract_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw = data.get("items") or data.get("products")
    if raw is None and isinstance(data.get("catalog"), dict):
        raw = data["catalog"].get("products")
    return raw if isinstance(raw, list) else []


def _sub_type(product: dict[str, Any]) -> str:
    raw = str(product.get("type") or "general").strip()
    aliases = {
        "vmware": "VMware",
        "openiaas": "OpenIaaS",
        "baremetal": "Bare Metal",
        "ip": "IP",
    }
    return aliases.get(raw.lower(), raw.title())


def enrich_pricing(item: dict[str, Any]) -> dict[str, Any]:
    pricing = item.get("pricing") or {}
    public_price = _safe_float(
        pricing.get("public_price")
        or pricing.get("unit_price")
        or pricing.get("price")
        or pricing.get("monthly_price"),
    )
    discounts = pricing.get("discounts") if isinstance(pricing, dict) else {}
    discount_percent = _safe_float(discounts.get("standard") if isinstance(discounts, dict) else 0)
    discounted_price = public_price * (1 - discount_percent / 100)

    out = dict(item)
    out["pricing_summary"] = {
        "public_price": round(public_price, 4),
        "discount_percent": round(discount_percent, 2),
        "discounted_price": round(discounted_price, 4),
        "engagement": pricing.get("engagement"),
        "unit": item.get("unit"),
        "base_quantity": item.get("base_quantity") or pricing.get("base_quantity") or 1,
        "min_quantity": pricing.get("min_quantity") or item.get("min_quantity") or 1,
    }
    return out


@lru_cache(maxsize=1)
def load_catalog_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    root = catalogs_dir()

    for category_dir in ("cloud", "services"):
        category_path = root / category_dir
        if not category_path.exists():
            continue

        for yaml_file in sorted(category_path.glob("*.yaml")):
            data = _load_yaml(yaml_file)
            category = str(data.get("metadata", {}).get("category") or category_dir).title()
            type_name = _title(yaml_file.stem)

            for index, product in enumerate(_extract_items(data)):
                if not isinstance(product, dict):
                    continue
                name = product.get("name") or product.get("title") or "Sans nom"
                sku = product.get("sku") or f"{category_dir}:{yaml_file.stem}:{index}"
                item = {
                    "sku": str(sku),
                    "name": str(name),
                    "title": str(name),
                    "description": product.get("description"),
                    "category": category,
                    "type": type_name,
                    "sub_type": _sub_type(product),
                    "unit": product.get("unit") or "unite",
                    "base_quantity": product.get("base_quantity"),
                    "pricing": product.get("pricing") or {},
                    "specs": product.get("specs") or {},
                    "metadata": product.get("metadata") or {},
                    "status": product.get("status") or product.get("metadata", {}).get("status"),
                    "source_file": str(yaml_file.relative_to(root)),
                }
                items.append(enrich_pricing(item))

    return sorted(items, key=lambda item: (item["category"], item["type"], item["name"].lower()))


def find_catalog_item(sku: str) -> Optional[dict[str, Any]]:
    needle = sku.strip().lower()
    return next((item for item in load_catalog_items() if item.get("sku", "").lower() == needle), None)


def _flatten_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(f"{key} {_flatten_text(val)}" for key, val in value.items())
    if isinstance(value, list):
        return " ".join(_flatten_text(val) for val in value)
    return str(value or "")


def _tokens(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z0-9àâäéèêëîïôöùûüç\-]+", value.lower())
        if len(token) >= 2 and token not in STOPWORDS_FR
    ]


def _score(item: dict[str, Any], query: str) -> int:
    query_tokens = _tokens(query)
    if not query_tokens:
        return 0

    weighted_fields = [
        (item.get("sku"), 8),
        (item.get("name"), 6),
        (item.get("title"), 6),
        (item.get("type"), 4),
        (item.get("sub_type"), 4),
        (item.get("category"), 3),
        (item.get("description"), 3),
        (_flatten_text(item.get("specs")), 1),
    ]

    score = 0
    for field, weight in weighted_fields:
        field_tokens = set(_tokens(str(field or "")))
        field_text = str(field or "").lower()
        for token in query_tokens:
            if token in field_tokens:
                score += weight
            elif token in field_text:
                score += max(1, weight // 2)
    return score


def search_catalog(
    query: Optional[str] = None,
    category: Optional[str] = None,
    item_type: Optional[str] = None,
    sub_type: Optional[str] = None,
    include_deprecated: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[list[dict[str, Any]], int]:
    candidates = load_catalog_items()

    if not include_deprecated:
        candidates = [
            item
            for item in candidates
            if str(item.get("status") or "").lower() not in {"deprecated", "retired"}
        ]
    if category:
        candidates = [item for item in candidates if category.lower() in item["category"].lower()]
    if item_type:
        candidates = [item for item in candidates if item_type.lower() in item["type"].lower()]
    if sub_type:
        candidates = [item for item in candidates if sub_type.lower() in item["sub_type"].lower()]

    if query:
        exact = [item for item in candidates if item.get("sku", "").lower() == query.strip().lower()]
        if exact:
            return exact, len(exact)

        scored = [(_score(item, query), item) for item in candidates]
        candidates = [item for score, item in sorted(scored, key=lambda row: row[0], reverse=True) if score > 0]

    total = len(candidates)
    return candidates[skip : skip + limit], total
