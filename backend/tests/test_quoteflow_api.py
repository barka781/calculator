"""Tests de la liaison API QuoteFlow (QuoteflowApiProvider).

Couvre l'ARCHITECTURE du provider, pas un comportement de complaisance :
  * fidélité du mapping items API -> contrat pivot (mêmes normaliseurs que l'ingestion fichiers) ;
  * pagination (avec et sans `total`) ;
  * gestion d'erreur HTTP / réseau -> QuoteflowApiError (permet le repli) ;
  * sélection `default_provider()` selon la configuration ;
  * garde-fou URL manquante.

Aucun accès réseau (httpx.MockTransport) ni base de données.
"""
import httpx
import pytest

from app.ingest import (
    CatalogProvider,
    LocalYamlProvider,
    default_provider,
    normalize_license_item,
    normalize_product_item,
)
from app.quoteflow_api import QuoteflowApiError, QuoteflowApiProvider


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://qf.test")


def _make_handler(products=None, licenses=None, status=200, raise_network=False, with_total=True):
    products = products or []
    licenses = licenses or []

    def handler(request: httpx.Request) -> httpx.Response:
        if raise_network:
            raise httpx.ConnectError("connexion refusée", request=request)
        if status >= 400:
            return httpx.Response(status, json={"detail": "erreur simulée"})
        path = request.url.path
        skip = int(request.url.params.get("skip", "0"))
        limit = int(request.url.params.get("limit", "500"))
        data = products if ("catalog" in path or "product" in path) else licenses
        page = data[skip : skip + limit]
        body = {"items": page}
        if with_total:
            body["total"] = len(data)
        return httpx.Response(200, json=body)

    return handler


def _provider(handler, **kwargs) -> QuoteflowApiProvider:
    return QuoteflowApiProvider(base_url="http://qf.test", client=_client(handler), **kwargs)


# --------------------------------------------------------------------------- #
# Mapping vers le contrat pivot
# --------------------------------------------------------------------------- #
def test_products_mapping_matches_pivot_contract():
    raw = {
        "sku": "VM-S",
        "name": "VM Small",
        "description": "petite VM",
        "category": "compute",
        "type": "vm",
        "unit": "instance",
        "pricing": {
            "public_price": "35,99 €",  # format YAML (virgule + symbole)
            "discounts": {"standard": 0.1},
            "engagement": "12 mois",
        },
        "specs": {"vcpu": 2},
        "metadata": {"status": "active"},
    }
    rows = list(_provider(_make_handler(products=[raw])).products())

    assert len(rows) == 1
    row = rows[0]
    assert row["sku"] == "VM-S"
    assert row["name"] == "VM Small"
    assert row["catalog"] == "cloud"  # défaut documenté tant que l'API ne le porte pas
    assert row["category"] == "compute"
    assert row["type"] == "vm"
    assert row["public_price"] == pytest.approx(35.99)
    assert row["discount_standard"] == pytest.approx(0.1)
    assert row["engagement"] == "12 mois"
    assert row["status"] == "active"
    assert row["specs"] == {"vcpu": 2}
    assert row["pricing"]["public_price"] == "35,99 €"  # pricing brut conservé
    assert row["source_file"] is None  # pas de fichier source via l'API


def test_licenses_mapping_matches_pivot_contract():
    raw = {
        "sku": "LIC-1",
        "name": "Windows Server",
        "vendor": "Microsoft",
        "edition": "Standard",
        "type": "os",
        "unit": "core",
        "pricing": {
            "public_price": 192.0,
            "purchase_price": 107.0,
            "currency": "EUR",
            "term": "annual",
            "engagement": "12 mois",
        },
        "metadata": {"validity_end": "2026-12-31"},
    }
    rows = list(_provider(_make_handler(licenses=[raw])).licenses())

    assert len(rows) == 1
    row = rows[0]
    assert row["sku"] == "LIC-1"
    assert row["vendor"] == "Microsoft"
    assert row["edition"] == "Standard"
    assert row["public_price"] == pytest.approx(192.0)
    assert row["purchase_price"] == pytest.approx(107.0)
    assert row["currency"] == "EUR"
    assert row["term"] == "annual"
    assert row["validity_end"] == "2026-12-31"
    assert row["category"] == "licence"  # défaut quand absent


def test_non_dict_items_are_ignored():
    handler = _make_handler(products=[{"sku": "OK", "name": "ok", "pricing": {}}])
    # On injecte un item parasite non-dict via un handler personnalisé.
    def noisy(request):
        resp = handler(request)
        body = resp.json()
        body["items"] = body["items"] + ["chaine-parasite", 42]
        return httpx.Response(200, json=body)

    rows = list(_provider(noisy).products())
    assert [r["sku"] for r in rows] == ["OK"]


# --------------------------------------------------------------------------- #
# Pagination
# --------------------------------------------------------------------------- #
def test_pagination_collects_all_pages_with_total():
    products = [{"sku": f"P{i}", "name": f"prod {i}", "pricing": {}} for i in range(5)]
    calls = {"n": 0}
    base = _make_handler(products=products)

    def counting(request):
        calls["n"] += 1
        return base(request)

    provider = QuoteflowApiProvider(base_url="http://qf.test", client=_client(counting), page_size=2)
    rows = list(provider.products())

    assert [r["sku"] for r in rows] == [f"P{i}" for i in range(5)]
    # 5 items / page 2 -> skip 0,2,4 = 3 requêtes (arrêt sur total atteint).
    assert calls["n"] == 3


def test_pagination_without_total_stops_on_short_page():
    licenses = [{"sku": f"L{i}", "name": f"lic {i}", "pricing": {}} for i in range(3)]
    handler = _make_handler(licenses=licenses, with_total=False)
    provider = QuoteflowApiProvider(base_url="http://qf.test", client=_client(handler), page_size=2)
    rows = list(provider.licenses())
    assert [r["sku"] for r in rows] == ["L0", "L1", "L2"]


def test_empty_response_returns_nothing():
    rows = list(_provider(_make_handler(products=[])).products())
    assert rows == []


# --------------------------------------------------------------------------- #
# Erreurs -> QuoteflowApiError (permet le repli sur la source locale)
# --------------------------------------------------------------------------- #
def test_http_error_raises_quoteflow_api_error():
    with pytest.raises(QuoteflowApiError):
        list(_provider(_make_handler(status=500)).products())


def test_network_error_raises_quoteflow_api_error():
    with pytest.raises(QuoteflowApiError):
        list(_provider(_make_handler(raise_network=True)).products())


# --------------------------------------------------------------------------- #
# Sélection de provider & garde-fous
# --------------------------------------------------------------------------- #
def test_default_provider_uses_api_when_configured(monkeypatch):
    monkeypatch.setenv("CALCULATOR_QUOTEFLOW_API_URL", "http://quoteflow.test")
    assert isinstance(default_provider(), QuoteflowApiProvider)


def test_default_provider_falls_back_to_local_yaml(monkeypatch):
    monkeypatch.delenv("CALCULATOR_QUOTEFLOW_API_URL", raising=False)
    assert isinstance(default_provider(), LocalYamlProvider)


def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("CALCULATOR_QUOTEFLOW_API_URL", raising=False)
    with pytest.raises(QuoteflowApiError):
        QuoteflowApiProvider()


def test_bearer_token_sent_even_with_injected_client():
    """Le header Authorization doit partir même quand le client est injecté."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"items": [], "total": 0})

    provider = QuoteflowApiProvider(
        base_url="http://qf.test", token="secret-123", client=_client(handler)
    )
    list(provider.products())
    assert captured["auth"] == "Bearer secret-123"


def test_invalid_url_is_rejected_at_construction():
    with pytest.raises(QuoteflowApiError):
        QuoteflowApiProvider(base_url="not-a-url")


def test_scalar_json_payload_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=42)

    provider = QuoteflowApiProvider(base_url="http://qf.test", client=_client(handler))
    with pytest.raises(QuoteflowApiError):
        list(provider.products())


def test_max_pages_guard_raises_instead_of_truncating(monkeypatch):
    import app.quoteflow_api as qa

    monkeypatch.setattr(qa, "_MAX_PAGES", 3)

    def handler(request: httpx.Request) -> httpx.Response:
        # page toujours pleine (page_size=1), aucun `total` -> jamais d'arrêt normal
        return httpx.Response(200, json={"items": [{"sku": "X", "name": "x", "pricing": {}}]})

    provider = QuoteflowApiProvider(
        base_url="http://qf.test", client=_client(handler), page_size=1
    )
    with pytest.raises(QuoteflowApiError):
        list(provider.products())


def test_owned_client_is_closed_after_fetch(monkeypatch):
    real_client = httpx.Client(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, json={"items": [], "total": 0})
        ),
        base_url="http://qf.test",
    )
    provider = QuoteflowApiProvider(base_url="http://qf.test")  # client possédé
    monkeypatch.setattr(provider, "_new_client", lambda: real_client)
    list(provider.products())
    assert real_client.is_closed


# --------------------------------------------------------------------------- #
# Non-régression du mapping partagé (utilisé par LocalYaml ET l'API)
# --------------------------------------------------------------------------- #
def test_normalize_product_item_golden():
    row = normalize_product_item(
        {"name": "X", "pricing": {"public_price": 10}},
        catalog="cloud",
        default_category="compute",
        type_fallback="vm",
        source_file="cloud/x.yaml",
        catalog_version="1.2",
    )
    assert row["sku"] == "cloud:vm:X"  # fallback déterministe
    assert row["catalog"] == "cloud"
    assert row["category"] == "compute"
    assert row["type"] == "vm"
    assert row["public_price"] == pytest.approx(10.0)
    assert row["source_file"] == "cloud/x.yaml"
    assert row["catalog_version"] == "1.2"
    assert row["specs"] == {}
    assert row["item_metadata"] == {}


def test_normalize_license_item_golden():
    row = normalize_license_item(
        {"name": "L", "pricing": {"public_price": 5, "term": "monthly"}}
    )
    assert row["sku"] == ""  # sku absent -> chaîne vide
    assert row["category"] == "licence"
    assert row["public_price"] == pytest.approx(5.0)
    assert row["term"] == "monthly"


def test_normalize_product_item_preserves_zero_public_price():
    """#3 — un `public_price` de 0 (offre gratuite : activation VPC, Private
    Backbone…) doit être CONSERVÉ, pas traité comme « absent » au profit d'un
    autre champ. L'ancien `or`-chain renvoyait 99 (faux)."""
    row = normalize_product_item(
        {"name": "VPC", "pricing": {"public_price": 0.0, "unit_price": 99}},
        catalog="cloud",
        default_category="network",
        type_fallback="vpc",
    )
    assert row["public_price"] == 0.0  # PAS 99 : on ne « tombe » pas sur unit_price


def test_normalize_product_item_falls_through_only_when_field_absent():
    """Le repli sur un autre champ de prix ne joue que si `public_price` est
    réellement ABSENT (None), pas seulement falsy — non-régression de la résolution."""
    row = normalize_product_item(
        {"name": "X", "pricing": {"unit_price": 35}},
        catalog="cloud",
        default_category="compute",
        type_fallback="vm",
    )
    assert row["public_price"] == pytest.approx(35.0)


def test_run_falls_back_to_local_yaml_on_api_error(monkeypatch):
    from contextlib import contextmanager

    import app.ingest as ingest

    class FailingApi(CatalogProvider):
        name = "quoteflow_api"

        def products(self):
            raise QuoteflowApiError("API down")
            yield  # rend la méthode génératrice (jamais atteint)

        def licenses(self):
            yield {}

    class FakeLocal(CatalogProvider):
        name = "local_yaml"

        def products(self):
            yield {"sku": "P1"}

        def licenses(self):
            yield {"sku": "L1"}

    monkeypatch.setattr(ingest, "LocalYamlProvider", FakeLocal)
    monkeypatch.setattr(ingest, "init_db", lambda: None)
    monkeypatch.setattr(ingest, "_upsert", lambda session, model, rows, batch_size=1000: len(rows))

    @contextmanager
    def fake_scope():
        yield object()

    monkeypatch.setattr(ingest, "session_scope", fake_scope)

    result = ingest.run(FailingApi())
    assert result["provider"] == "local_yaml"
    assert result["products"] == 1
    assert result["licenses"] == 1


def test_run_falls_back_when_provider_construction_fails(monkeypatch):
    """URL API invalide configurée -> default_provider() lève à la construction.

    Le repli doit couvrir ce cas (construction incluse dans le try), pas seulement
    les erreurs d'acquisition.
    """
    from contextlib import contextmanager

    import app.ingest as ingest

    monkeypatch.setenv("CALCULATOR_QUOTEFLOW_API_URL", "not-a-url")  # active l'API, mais invalide

    class FakeLocal(CatalogProvider):
        name = "local_yaml"

        def products(self):
            yield {"sku": "P1"}

        def licenses(self):
            yield {"sku": "L1"}

    monkeypatch.setattr(ingest, "LocalYamlProvider", FakeLocal)
    monkeypatch.setattr(ingest, "init_db", lambda: None)
    monkeypatch.setattr(ingest, "_upsert", lambda session, model, rows, batch_size=1000: len(rows))

    @contextmanager
    def fake_scope():
        yield object()

    monkeypatch.setattr(ingest, "session_scope", fake_scope)

    result = ingest.run()  # provider=None -> default_provider() -> QuoteflowApiProvider() lève -> repli
    assert result["provider"] == "local_yaml"
    assert result["products"] == 1


# --------------------------------------------------------------------------- #
# Non-régression revue 2026-06-19
#  #1 — toute défaillance de la source live -> QuoteflowApiError (repli possible)
#  #2 — pagination pilotée sur la longueur BRUTE de page (pas de troncature)
# --------------------------------------------------------------------------- #
def test_malformed_pricing_raises_quoteflow_api_error():
    """#1(b) — un `pricing` non-dict ferait lever AttributeError au normaliseur.

    Le provider doit l'envelopper en QuoteflowApiError, sinon le repli YAML de
    `run()` (qui ne capte QUE QuoteflowApiError) serait court-circuité et
    l'ingestion planterait au lieu de retomber sur les YAML locaux.
    """
    handler = _make_handler(products=[{"sku": "BAD", "name": "x", "pricing": "gratuit"}])
    with pytest.raises(QuoteflowApiError):
        list(_provider(handler).products())


def test_client_construction_failure_raises_quoteflow_api_error(monkeypatch):
    """#1(a) — un échec de construction du client httpx (hors enveloppe d'origine)
    doit aussi devenir QuoteflowApiError pour permettre le repli."""
    import app.quoteflow_api as qa

    def boom(*args, **kwargs):
        raise RuntimeError("configuration httpx invalide")

    monkeypatch.setattr(qa.httpx, "Client", boom)
    provider = QuoteflowApiProvider(base_url="http://qf.test")  # client possédé -> _new_client construit
    with pytest.raises(QuoteflowApiError):
        list(provider.products())


def test_full_page_with_non_dict_does_not_truncate_pagination():
    """#2 — une page PLEINE contenant un item non-dict ne doit pas être prise pour
    une fin de liste. La pagination se pilote sur la longueur BRUTE de la page ;
    avec l'ancien `len(batch)` (filtré), la collecte s'arrêtait dès la 1re page."""
    pages = {
        0: ["parasite", {"sku": "P0", "name": "p0", "pricing": {}}],  # 2 bruts (plein), 1 dict
        2: [{"sku": "P1", "name": "p1", "pricing": {}}, 99],          # 2 bruts (plein), 1 dict
        4: [{"sku": "P2", "name": "p2", "pricing": {}}],              # 1 brut (court) -> fin
    }
    seen_skips = []

    def handler(request: httpx.Request) -> httpx.Response:
        skip = int(request.url.params.get("skip", "0"))
        seen_skips.append(skip)
        return httpx.Response(200, json={"items": pages.get(skip, [])})  # sans `total`

    provider = QuoteflowApiProvider(
        base_url="http://qf.test", client=_client(handler), page_size=2
    )
    rows = list(provider.products())

    assert [r["sku"] for r in rows] == ["P0", "P1", "P2"]  # aucune troncature
    # skip avance sur la longueur BRUTE (2, 2, 1) et non sur le compte filtré (1, 1, …)
    assert seen_skips == [0, 2, 4]


def test_non_dict_noise_does_not_break_total_stop():
    """#2 (variante avec `total`) — le bruit non-dict ne doit pas fausser l'arrêt
    sur `total` : `skip` compte les items bruts, donc `skip >= total` se déclenche
    au bon moment et tous les items utiles sont collectés."""
    pages = {
        0: [{"sku": "P0", "name": "p0", "pricing": {}}, "parasite"],  # 2 bruts
        2: [{"sku": "P1", "name": "p1", "pricing": {}}, "parasite"],  # 2 bruts
    }

    def handler(request: httpx.Request) -> httpx.Response:
        skip = int(request.url.params.get("skip", "0"))
        return httpx.Response(200, json={"items": pages.get(skip, []), "total": 4})

    provider = QuoteflowApiProvider(
        base_url="http://qf.test", client=_client(handler), page_size=2
    )
    rows = list(provider.products())
    assert [r["sku"] for r in rows] == ["P0", "P1"]
