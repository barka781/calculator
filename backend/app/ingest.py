"""Ingestion des catalogues vers PostgreSQL.

Architecture en deux temps, volontairement découplés :
1. ACQUISITION — un `CatalogProvider` fournit les lignes normalisées
   (products + licenses). Aujourd'hui : `LocalYamlProvider` (YAML versionnés
   de backend/data/). Demain : `QuoteflowApiProvider` (API REST quoteflow),
   sans rien changer ci-dessous.
2. ÉCRITURE — normalisation déjà faite par le provider, puis upsert idempotent
   par `sku` (ON CONFLICT DO UPDATE). Relançable à volonté, incrémental.

Le format des dicts renvoyés par un provider EST le contrat pivot
(cf. CatalogProvider) : toute nouvelle source doit le respecter.

Usage (depuis calculator/backend, venv activé) :
    python -m app.ingest
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Iterable, Optional

import yaml
from sqlalchemy.dialects.postgresql import insert

from .config import catalogs_dir, licences_file
from .db import engine, init_db, session_scope
from .db_models import License, Product


# --------------------------------------------------------------------------- #
# Helpers de parsing
# --------------------------------------------------------------------------- #
def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ".").replace("EUR", "").replace("€", "").strip())
    except ValueError:
        return None


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _items(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw = data.get("items") or data.get("products") or data.get("licenses")
    if raw is None and isinstance(data.get("catalog"), dict):
        raw = data["catalog"].get("products")
    return [it for it in raw if isinstance(it, dict)] if isinstance(raw, list) else []


# --------------------------------------------------------------------------- #
# Construction des lignes
# --------------------------------------------------------------------------- #
def _product_rows() -> Iterable[dict[str, Any]]:
    root = catalogs_dir()
    for catalog in ("cloud", "services"):
        directory = root / catalog
        if not directory.exists():
            continue
        for yaml_file in sorted(directory.glob("*.yaml")):
            data = _load_yaml(yaml_file)
            meta = data.get("metadata") or {}
            version = data.get("version")
            default_category = str(meta.get("category") or catalog)
            type_fallback = yaml_file.stem
            for item in _items(data):
                pricing = item.get("pricing") or {}
                discounts = pricing.get("discounts") if isinstance(pricing, dict) else {}
                public_price = _safe_float(
                    pricing.get("public_price")
                    or pricing.get("unit_price")
                    or pricing.get("price")
                    or pricing.get("monthly_price")
                )
                yield {
                    "sku": str(item.get("sku") or f"{catalog}:{yaml_file.stem}:{item.get('name')}"),
                    "name": str(item.get("name") or item.get("title") or "Sans nom"),
                    "description": item.get("description"),
                    "catalog": catalog,
                    "category": str(item.get("category") or default_category),
                    "type": str(item.get("type") or type_fallback),
                    "sub_type": item.get("sub_type"),
                    "unit": item.get("unit"),
                    "status": item.get("status") or (item.get("metadata") or {}).get("status"),
                    "public_price": public_price,
                    "discount_standard": _safe_float(
                        discounts.get("standard") if isinstance(discounts, dict) else None
                    ),
                    "engagement": (str(pricing.get("engagement")) if pricing.get("engagement") is not None else None),
                    "base_quantity": _safe_float(item.get("base_quantity") or pricing.get("base_quantity")),
                    "min_quantity": _safe_float(pricing.get("min_quantity") or item.get("min_quantity")),
                    "pricing": pricing or {},
                    "specs": item.get("specs") or {},
                    "item_metadata": item.get("metadata") or {},
                    "source_file": str(yaml_file.relative_to(root)),
                    "catalog_version": str(version) if version is not None else None,
                }


def _license_rows() -> Iterable[dict[str, Any]]:
    path = licences_file()
    if not path.exists():
        return
    data = _load_yaml(path)
    for item in _items(data):
        pricing = item.get("pricing") or {}
        meta = item.get("metadata") or {}
        engagement = pricing.get("engagement")
        yield {
            "sku": str(item.get("sku") or "").strip(),
            "name": str(item.get("name") or "Sans nom"),
            "description": item.get("description"),
            "vendor": item.get("vendor"),
            "edition": item.get("edition"),
            "category": item.get("category") or "licence",
            "type": item.get("type"),
            "unit": item.get("unit"),
            "public_price": _safe_float(pricing.get("public_price")),
            "purchase_price": _safe_float(pricing.get("purchase_price")),
            "currency": pricing.get("currency"),
            "term": pricing.get("term"),
            "engagement": str(engagement) if engagement is not None else None,
            "validity_end": meta.get("validity_end"),
            "pricing": pricing or {},
            "item_metadata": meta or {},
        }


# --------------------------------------------------------------------------- #
# Provider : abstraction de la SOURCE des données (le seul point qui changera
# quand l'API quoteflow existera). Le contrat pivot ci-dessous est la forme
# normalisée qu'une nouvelle source devra produire — ni plus, ni moins.
# --------------------------------------------------------------------------- #
class CatalogProvider(ABC):
    """Fournit les lignes normalisées prêtes à upserter.

    Contrat pivot — un `product` est un dict avec les clés :
        sku, name, description, catalog ('cloud'|'services'), category, type,
        sub_type, unit, status, public_price, discount_standard, engagement,
        base_quantity, min_quantity, pricing(dict), specs(dict),
        item_metadata(dict), source_file, catalog_version

    Une `license` est un dict avec les clés :
        sku, name, description, vendor, edition, category, type, unit,
        public_price, purchase_price, currency, term, engagement,
        validity_end, pricing(dict), item_metadata(dict)

    Les colonnes manquantes peuvent être None ; `pricing`/`specs`/`item_metadata`
    par défaut {}. La clé d'idempotence est `sku`.
    """

    name = "abstract"

    @abstractmethod
    def products(self) -> Iterable[dict[str, Any]]:
        ...

    @abstractmethod
    def licenses(self) -> Iterable[dict[str, Any]]:
        ...


class LocalYamlProvider(CatalogProvider):
    """Acquisition depuis les YAML versionnés de backend/data/ (source actuelle)."""

    name = "local_yaml"

    def products(self) -> Iterable[dict[str, Any]]:
        return _product_rows()

    def licenses(self) -> Iterable[dict[str, Any]]:
        return _license_rows()


# --------------------------------------------------------------------------- #
# Upsert
# --------------------------------------------------------------------------- #
def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Garde la dernière occurrence par sku (évite les doublons d'un même run)."""
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        sku = row.get("sku")
        if sku:
            seen[sku] = row
    return list(seen.values())


def _upsert(session, model, rows: list[dict[str, Any]], batch_size: int = 1000) -> int:
    rows = _dedupe([r for r in rows if r.get("sku")])
    if not rows:
        return 0
    update_cols = [c.name for c in model.__table__.columns if c.name not in ("id", "sku", "created_at")]
    total = 0
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        stmt = insert(model).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["sku"],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(stmt)
        total += len(batch)
    return total


def run(provider: Optional[CatalogProvider] = None) -> dict[str, Any]:
    """Ingère les données fournies par `provider` (défaut : LocalYamlProvider)."""
    provider = provider or LocalYamlProvider()
    init_db()
    with session_scope() as session:
        n_products = _upsert(session, Product, list(provider.products()))
        n_licenses = _upsert(session, License, list(provider.licenses()))
    return {"products": n_products, "licenses": n_licenses, "provider": provider.name}


def main() -> None:
    print(f"Connexion : {engine.url}")
    print("Ingestion en cours…")
    counts = run()
    print(f"  provider : {counts['provider']}")
    print(f"  products : {counts['products']}")
    print(f"  licenses : {counts['licenses']}")
    print("Terminé.")


if __name__ == "__main__":
    main()
