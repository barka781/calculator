"""Acquisition du catalogue depuis l'API REST QuoteFlow (source live « définitive »).

PRÉPARATION — la liaison HTTP est prête mais l'URL réelle et le FORMAT exact de
l'API QuoteFlow restent à confirmer. Hypothèses (toutes paramétrables, donc
ajustables sans réécriture du flux d'ingestion) :

  * Endpoints : `CALCULATOR_QUOTEFLOW_API_PRODUCTS_PATH` / `..._LICENSES_PATH`
    (défauts `/api/catalog` et `/api/licenses`).
  * Réponse : soit une liste brute d'items, soit une enveloppe
    `{"items": [...], "total": N}` (les clés `products`/`licenses`/`catalog.products`
    sont aussi reconnues via `ingest._items`).
  * Items « façon YAML » : mêmes clés que le contrat pivot (sku, name, pricing{…},
    specs, metadata…). Le mapping réutilise EXACTEMENT les normaliseurs de
    `ingest` (aucune divergence de parsing).
  * Pagination : `skip` / `limit`. Arrêt sur `total` si fourni, sinon dès qu'une
    page est plus courte que `limit`.
  * Auth : en-tête `Authorization: Bearer <token>` si un token est configuré.

Toute erreur de liaison lève `QuoteflowApiError` : l'appelant (ingestion) peut
ainsi se replier proprement sur la source locale (résilience ANSSI).
"""
from __future__ import annotations

from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import httpx

from .config import (
    quoteflow_api_licenses_path,
    quoteflow_api_page_size,
    quoteflow_api_products_path,
    quoteflow_api_timeout_seconds,
    quoteflow_api_token,
    quoteflow_api_url,
)
from .ingest import (
    CatalogProvider,
    _raw_items,
    normalize_license_item,
    normalize_product_item,
)

# Garde-fou : nombre maximum de pages par endpoint (anti-boucle infinie si la
# pagination de l'API ne se comporte pas comme supposé). 8834 licences / 500 ≈ 18.
_MAX_PAGES = 1000


class QuoteflowApiError(RuntimeError):
    """Échec de la liaison vers l'API QuoteFlow (réseau, HTTP, ou payload invalide)."""


class QuoteflowApiProvider(CatalogProvider):
    """Acquisition depuis l'API REST QuoteFlow (cf. en-tête du module)."""

    name = "quoteflow_api"

    def __init__(
        self,
        base_url: Optional[str] = None,
        *,
        token: Optional[str] = None,
        timeout: Optional[float] = None,
        page_size: Optional[int] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        resolved = (base_url if base_url is not None else quoteflow_api_url()) or ""
        self.base_url = resolved.rstrip("/")
        if not self.base_url:
            raise QuoteflowApiError(
                "URL de l'API QuoteFlow non configurée (CALCULATOR_QUOTEFLOW_API_URL)."
            )
        parsed = urlparse(self.base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise QuoteflowApiError(
                f"URL de l'API QuoteFlow invalide : {self.base_url!r} "
                "(schéma http/https et hôte requis)."
            )
        self.token = token if token is not None else quoteflow_api_token()
        self.timeout = timeout if timeout is not None else quoteflow_api_timeout_seconds()
        self.page_size = page_size if page_size is not None else quoteflow_api_page_size()
        # Client injectable pour les tests (httpx.MockTransport). Si fourni, on ne
        # le ferme pas (cycle de vie géré par l'appelant).
        self._external_client = client

    # -- HTTP ---------------------------------------------------------------- #
    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _new_client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        # La construction est enveloppée : toute défaillance de la source live doit
        # se présenter comme QuoteflowApiError pour que l'ingestion puisse se replier
        # sur les YAML locaux (priorité disponibilité ANSSI) plutôt que de planter.
        try:
            return httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                headers=self._headers(),
            )
        except Exception as exc:  # noqa: BLE001
            raise QuoteflowApiError(
                f"Construction du client HTTP QuoteFlow échouée : {exc!s}"
            ) from exc

    def _fetch_all(self, path: str) -> list[dict[str, Any]]:
        """Récupère tous les items d'un endpoint paginé (`skip`/`limit`)."""
        client = self._new_client()
        owns_client = self._external_client is None
        collected: list[dict[str, Any]] = []
        try:
            skip = 0
            for _ in range(_MAX_PAGES):
                try:
                    response = client.get(
                        path,
                        params={"skip": skip, "limit": self.page_size},
                        headers=self._headers(),
                    )
                except httpx.HTTPError as exc:
                    raise QuoteflowApiError(
                        f"Liaison API QuoteFlow échouée sur GET {path} : {exc!s}"
                    ) from exc

                if response.status_code >= 400:
                    raise QuoteflowApiError(f"GET {path} -> HTTP {response.status_code}")

                try:
                    payload = response.json()
                except ValueError as exc:
                    raise QuoteflowApiError(
                        f"Réponse non-JSON sur GET {path} : {exc!s}"
                    ) from exc

                if not isinstance(payload, (list, dict)):
                    raise QuoteflowApiError(
                        f"Réponse de forme inattendue sur GET {path} : "
                        f"{type(payload).__name__} (liste ou objet JSON attendu)."
                    )

                # Longueur de page = items BRUTS renvoyés (avant filtrage des
                # non-dicts). Piloter `skip` et l'arrêt « page courte » sur ce
                # compte évite qu'un item parasite fasse passer une page pleine
                # pour une fin de liste (troncature silencieuse).
                raw_page = payload if isinstance(payload, list) else _raw_items(payload)
                page_len = len(raw_page)
                if page_len == 0:
                    break
                collected.extend(item for item in raw_page if isinstance(item, dict))

                total = payload.get("total") if isinstance(payload, dict) else None
                skip += page_len
                if total is not None:
                    try:
                        if skip >= int(total):
                            break
                    except (TypeError, ValueError):
                        pass
                if page_len < self.page_size:
                    break
            else:
                # Sortie par épuisement de _MAX_PAGES sans condition d'arrêt normale :
                # pour une source live, on refuse un catalogue tronqué silencieusement.
                raise QuoteflowApiError(
                    f"Pagination de GET {path} non terminée après {_MAX_PAGES} pages "
                    "(arrêt anormal — 'total' manquant ou pages toujours pleines)."
                )
            return collected
        finally:
            if owns_client:
                client.close()

    # -- Contrat CatalogProvider -------------------------------------------- #
    def products(self) -> Iterable[dict[str, Any]]:
        for item in self._fetch_all(quoteflow_api_products_path()):
            try:
                # TODO(API réelle) : déterminer `catalog` (cloud/services) depuis
                # l'item ou l'endpoint si l'API ne le porte pas explicitement.
                catalog = str(item.get("catalog") or "cloud")
                type_fallback = str(item.get("type") or "api")
                default_category = str(item.get("category") or catalog)
                yield normalize_product_item(
                    item,
                    catalog=catalog,
                    default_category=default_category,
                    type_fallback=type_fallback,
                    source_file=None,
                    catalog_version=None,
                )
            except Exception as exc:  # noqa: BLE001
                # Donnée live malformée (ex. `pricing` non-dict -> AttributeError) :
                # transformée en QuoteflowApiError pour permettre le repli YAML
                # plutôt qu'un crash de l'ingestion.
                raise QuoteflowApiError(
                    f"Normalisation produit échouée (sku={item.get('sku')!r}) : {exc!s}"
                ) from exc

    def licenses(self) -> Iterable[dict[str, Any]]:
        for item in self._fetch_all(quoteflow_api_licenses_path()):
            try:
                yield normalize_license_item(item)
            except Exception as exc:  # noqa: BLE001
                raise QuoteflowApiError(
                    f"Normalisation licence échouée (sku={item.get('sku')!r}) : {exc!s}"
                ) from exc
