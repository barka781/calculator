import asyncio
from contextlib import asynccontextmanager
import urllib.parse
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .architecture import (
    build_service_appliance_offer,
    calculate_architecture,
    calculate_managed_service_offer,
)
from .catalog import find_catalog_item, load_catalog_items, search_catalog
from .config import (
    calculator_version,
    catalogs_dir,
    data_source,
    licences_file,
    source_catalogs_dir,
    source_licences_dir,
    sync_poll_interval_seconds,
)
from .export import render_quote
from .licenses import find_license_item, load_license_items, search_licenses
from .models import ArchitectureRequest, ExportQuoteRequest, QuoteRequest, QuoteResponse
from .quote import calculate_quote
from .sync import sync_catalog as run_sync_catalog
from .sync import sync_summary
from .sync import sync_status


async def _run_periodic_sync(interval_seconds: int) -> None:
    while True:
        try:
            await asyncio.to_thread(run_sync_catalog, True)
        except Exception as exc:  # noqa: BLE001
            print(f"[sync] Synchronisation automatique échouée: {exc!s}", flush=True)

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    interval = sync_poll_interval_seconds()
    task = None
    if interval > 0:
        print(f"[sync] Synchronisation automatique activée toutes les {interval} secondes.", flush=True)
        task = asyncio.create_task(_run_periodic_sync(interval))
    else:
        print("[sync] Synchronisation automatique désactivée.", flush=True)

    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="Cloud Temple Calculator API",
    version=calculator_version(),
    description="API publique du calculateur Cloud Temple, adossée à PostgreSQL (repli YAML si BDD indisponible).",
    lifespan=lifespan,
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
    sync = sync_summary()
    return {
        "status": "ok",
        "version": calculator_version(),
        "data_source": data_source(),
        "catalog_items": catalog_count,
        "license_items": license_count,
        "catalogs_dir": str(catalogs_dir()),
        "licences_file": str(licences_file()),
        "source_catalogs_dir": str(source_catalogs_dir()),
        "source_licences_dir": str(source_licences_dir()),
        "sync": {
            "is_synchronized": sync.get("is_synchronized"),
            "needs_sync": sync.get("needs_sync"),
            "poll_interval_seconds": sync_poll_interval_seconds(),
            "source_available": sync.get("source_available"),
            "source": sync.get("source"),
            "last_sync": sync.get("last_sync"),
            "delta": sync.get("delta"),
            "status_endpoint": sync.get("status_endpoint"),
        },
    }


@app.get("/api/sync/status")
def get_sync_status() -> dict[str, Any]:
    return sync_status()


@app.post("/api/sync/catalog")
def post_sync_catalog(
    refresh: bool = Query(default=True, description="Rafraichit la source live configuree avant copie."),
) -> dict[str, Any]:
    try:
        return run_sync_catalog(refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/catalog")
def list_catalog(
    q: Optional[str] = Query(default=None, description="Recherche texte sur SKU, nom, type, specs"),
    category: Optional[str] = None,
    type: Optional[str] = None,
    sub_type: Optional[str] = None,
    include_deprecated: bool = True,
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


@app.post("/api/quote/export")
def export_quote(
    request: ExportQuoteRequest,
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf|html)$"),
) -> StreamingResponse:
    if not request.lines:
        raise HTTPException(status_code=422, detail="Le devis est vide : aucune ligne à exporter.")
    quote = calculate_quote(request)
    meta = {"project": request.project, "date": request.date}
    try:
        content, content_type, ext = render_quote(quote, format, meta)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    base = (request.project or "devis-cloud-temple").strip() or "devis-cloud-temple"
    safe = "".join(c if c.isalnum() or c in "-_ " else "-" for c in base).strip().replace(" ", "-")
    filename = f"{safe or 'devis'}.{ext}"
    disposition = f"attachment; filename=\"{filename}\"; filename*=UTF-8''{urllib.parse.quote(filename)}"
    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Content-Disposition": disposition},
    )


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
