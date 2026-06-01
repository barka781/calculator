from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .architecture import (
    build_service_appliance_offer,
    calculate_architecture,
    calculate_managed_service_offer,
)
from .catalog import find_catalog_item, load_catalog_items, search_catalog
from .config import catalogs_dir, licences_file
from .licenses import find_license_item, load_license_items, search_licenses
from .models import ArchitectureRequest, QuoteRequest, QuoteResponse
from .quote import calculate_quote


app = FastAPI(
    title="Cloud Temple Calculator API",
    version="0.1.0",
    description="API publique du calculateur Cloud Temple, extraite de QuoteFlow sans DB ni services externes.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    catalog_count = len(load_catalog_items())
    license_count = len(load_license_items())
    return {
        "status": "ok",
        "catalog_items": catalog_count,
        "license_items": license_count,
        "catalogs_dir": str(catalogs_dir()),
        "licences_file": str(licences_file()),
    }


@app.get("/api/catalog")
def list_catalog(
    q: Optional[str] = Query(default=None, description="Recherche texte sur SKU, nom, type, specs"),
    category: Optional[str] = None,
    type: Optional[str] = None,
    sub_type: Optional[str] = None,
    include_deprecated: bool = False,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, Any]:
    items, total = search_catalog(
        query=q,
        category=category,
        item_type=type,
        sub_type=sub_type,
        include_deprecated=include_deprecated,
        skip=skip,
        limit=limit,
    )
    return {"status": "success", "items": items, "total": total, "skip": skip, "limit": limit}


@app.get("/api/catalog/{sku}")
def get_catalog_item(sku: str) -> dict[str, Any]:
    item = find_catalog_item(sku)
    if not item:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return item


@app.get("/api/licenses")
def list_licenses(
    q: Optional[str] = Query(default=None, description="Recherche texte sur SKU, nom, vendor, edition"),
    vendor: Optional[str] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, Any]:
    items, total = search_licenses(query=q, vendor=vendor, skip=skip, limit=limit)
    return {"status": "success", "items": items, "total": total, "skip": skip, "limit": limit}


@app.get("/api/licenses/{sku}")
def get_license_item(sku: str) -> dict[str, Any]:
    item = find_license_item(sku)
    if not item:
        raise HTTPException(status_code=404, detail="Licence introuvable")
    return item


@app.post("/api/quote", response_model=QuoteResponse)
def quote(request: QuoteRequest) -> QuoteResponse:
    return calculate_quote(request)


@app.post("/api/architecture/calculate")
def architecture(request: ArchitectureRequest) -> dict[str, Any]:
    return calculate_architecture(request)


@app.post("/api/managed-services/calculate")
def managed_services(payload: dict[str, Any]) -> dict[str, Any]:
    assets = payload.get("assets") or []
    if not isinstance(assets, list):
        raise HTTPException(status_code=422, detail="assets doit etre une liste")
    return calculate_managed_service_offer(assets)


@app.post("/api/appliances/{appliance_type}/offer")
def appliance_offer(appliance_type: str, specs: dict[str, Any]) -> dict[str, Any]:
    result = build_service_appliance_offer(appliance_type, specs)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result
