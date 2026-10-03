"""Tests de bout en bout de la stack Docker Compose, vue depuis Internet (le WAF).

Ils vérifient la promesse de déploiement, pas le calcul (couvert par backend/tests) :
- le parcours réel de l'interface passe le WAF (pas de faux positif sur des
  saisies françaises réalistes : apostrophes, « & », guillemets, accents) ;
- l'API publique est une liste blanche : synchro et calculs non exposés → 404 ;
- les attaques courantes sont bloquées (injection SQL, XSS, verbe interdit,
  corps surdimensionné) ;
- seul le WAF publie un port ; backend, base et nginx restent internes ;
- le rate limiting de l'export répond 429.

Prérequis : stack démarrée (`docker compose up -d --build`). Lancement :

    CALCULATOR_E2E_URL=http://localhost:8088 \\
      backend/.venv/bin/python -m pytest tests/e2e -v

Sans CALCULATOR_E2E_URL, tout le module est ignoré (pytest habituel inchangé).
Le test de rate limiting sature la zone « export » de l'IP locale pendant ~1 min.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

BASE_URL = os.environ.get("CALCULATOR_E2E_URL", "").rstrip("/")
REPO_ROOT = Path(__file__).resolve().parents[2]
# Référence réelle du catalogue (lame OpenIaaS Standard).
SKU = "csp:fr1:iaas:openiaas:standard:v3"

pytestmark = pytest.mark.skipif(not BASE_URL, reason="CALCULATOR_E2E_URL non défini (stack non démarrée)")


def request(method: str, path: str, *, body: bytes | None = None, json_body: object = None,
            params: dict[str, str] | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    url = BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": "calculator-e2e", "Accept": "*/*", **(headers or {})}
    if json_body is not None:
        body = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


def raw_request(method: str, raw_path: str) -> int:
    """Envoie le chemin TEL QUEL (ni normalisation ni ré-encodage côté client),
    comme le ferait un attaquant, pour éprouver la normalisation du WAF."""
    parsed = urllib.parse.urlsplit(BASE_URL)
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parsed.hostname, parsed.port, timeout=30)
    try:
        conn.putrequest(method, raw_path, skip_accept_encoding=True)
        conn.putheader("User-Agent", "calculator-e2e")
        conn.putheader("Content-Length", "0")
        conn.endheaders()
        return conn.getresponse().status
    finally:
        conn.close()


def quote_body(**extra: object) -> dict:
    return {"lines": [{"sku": SKU, "quantity": 2, "source": "catalog"}], "period_months": 12, **extra}


# --- Parcours légitime ---------------------------------------------------------

def test_spa_is_served_with_security_headers_once():
    status, headers, body = request("GET", "/")
    assert status == 200
    assert b"Cloud Temple Calculator" in body
    # Posés par le WAF uniquement : une seule CSP (urllib fusionne les doublons
    # avec « , » — une virgule trahirait une seconde politique concurrente).
    csp = headers["content-security-policy"]
    assert "script-src 'self'" in csp and "," not in csp
    assert headers["x-frame-options"] == "DENY"
    assert headers["x-content-type-options"] == "nosniff"
    assert "strict-transport-security" in headers
    assert "server" not in headers


def test_health_reaches_backend():
    status, _, body = request("GET", "/health")
    assert status == 200
    data = json.loads(body)
    assert data["status"] == "ok"
    assert data["catalog_items"] > 0


def test_catalog_and_licenses_listing():
    status, _, body = request("GET", "/api/catalog", params={"limit": "1000", "include_deprecated": "false"})
    assert status == 200
    skus = {item["sku"] for item in json.loads(body)["items"]}
    assert SKU in skus
    status, _, body = request("GET", "/api/licenses", params={"limit": "1000", "skip": "0"})
    assert status == 200
    assert json.loads(body)["total"] > 0


def test_quote_returns_public_price():
    status, _, body = request("POST", "/api/quote", json_body=quote_body())
    assert status == 200
    data = json.loads(body)
    assert data["partner"] is False
    line = data["lines"][0]
    assert line["sku"] == SKU
    assert line["public_unit_price"] > 0
    # Prix public, aucune remise : le total mensuel vaut 2 × le prix unitaire.
    assert line["monthly_total"] == pytest.approx(2 * line["public_unit_price"], rel=1e-6)


def test_partner_flag_is_neutralised_on_public_deployment():
    # Autorité serveur : une requête qui se prétend partenaire reste au prix public.
    status, _, body = request("POST", "/api/quote", json_body=quote_body(partner=True, discount_percent=50))
    assert status == 200
    line = json.loads(body)["lines"][0]
    assert line["discounted_unit_price"] == pytest.approx(line["public_unit_price"])


@pytest.mark.parametrize("fmt,content_type,magic", [
    ("pdf", "application/pdf", b"%PDF"),
    ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b"PK"),
    ("html", "text/html", b"<"),
])
def test_exports_pass_through_waf(fmt, content_type, magic):
    status, headers, body = request("POST", "/api/quote/export", params={"format": fmt},
                                    json_body=quote_body(project="Projet e2e"))
    assert status == 200
    assert headers["content-type"].startswith(content_type)
    assert body.lstrip().startswith(magic)


@pytest.mark.parametrize("project", [
    "Migration ERP l'Oréal (phase 1)",
    "Projet R&D - 2026",
    "Plan de reprise d'activité \"PRA\"",
    "Hébergement données de santé — CHU",
])
def test_no_false_positive_on_french_project_names(project):
    status, _, _ = request("POST", "/api/quote", json_body=quote_body(project=project))
    assert status == 200


@pytest.mark.parametrize("query", ["d'archivage", "l'IA", "SQL Server", "Windows Server 2022 Datacenter"])
def test_no_false_positive_on_catalog_search(query):
    status, _, _ = request("GET", "/api/catalog", params={"q": query})
    assert status == 200


# --- Surface publique en liste blanche -----------------------------------------

@pytest.mark.parametrize("method,path", [
    ("POST", "/api/sync/catalog"),
    ("GET", "/api/sync/status"),
    ("POST", "/api/architecture/calculate"),
    ("POST", "/api/managed-services/calculate"),
    ("POST", "/api/appliances/firewall/offer"),
    ("GET", "/api/quote"),
])
def test_non_public_api_routes_are_hidden(method, path):
    status, _, _ = request(method, path, json_body={} if method == "POST" else None)
    assert status == 404


@pytest.mark.parametrize("raw_path", [
    "/api/catalog/../sync/status",
    "/api/catalog/%2e%2e/sync/status",
    "/api/catalog%2f..%2fsync/status",
    "/api/licenses/../../api/sync/status",
    "/api//sync/status",
    "/api/./sync/status",
    "/API/sync/status",
    "/%61pi/sync/status",
    "/api/sync/status;x",
])
def test_whitelist_cannot_be_bypassed_by_path_tricks(raw_path):
    # Refus attendu : 404 (hors liste blanche) ou 403 (traversée bloquée par le
    # CRS). Un 200 signifierait que la route cachée a été atteinte.
    for method, path in (("GET", raw_path), ("POST", raw_path.replace("sync/status", "sync/catalog"))):
        assert raw_request(method, path) in (403, 404), (method, path)


# --- Attaques bloquées par le WAF ----------------------------------------------

def test_sql_injection_is_blocked():
    status, _, _ = request("GET", "/api/catalog", params={"q": "' OR 1=1--"})
    assert status == 403


def test_xss_is_blocked():
    status, _, _ = request("GET", "/", params={"q": "<script>alert(1)</script>"})
    assert status == 403


def test_forbidden_http_verb_is_blocked():
    status, _, _ = request("DELETE", "/api/quote")
    assert status == 403


def test_oversized_body_is_rejected():
    big = quote_body(project="a" * 1_200_000)
    status, _, _ = request("POST", "/api/quote", json_body=big)
    assert status == 413


# --- Exposition réseau ---------------------------------------------------------

@pytest.mark.skipif(shutil.which("docker") is None, reason="docker indisponible")
def test_only_waf_publishes_a_port():
    out = subprocess.run(
        ["docker", "compose", "ps", "--format", "json"],
        cwd=REPO_ROOT, check=True, capture_output=True, text=True,
    ).stdout.strip()
    # Selon la version de Compose : un tableau JSON ou un objet JSON par ligne.
    services = json.loads(out) if out.startswith("[") else [json.loads(l) for l in out.splitlines()]
    published = {
        (s["Service"], p["TargetPort"])
        for s in services
        for p in (s.get("Publishers") or [])
        if p.get("PublishedPort")
    }
    assert {name for name, _ in published} == {"waf"}
    # Mode HTTP (8082) ou surcouche TLS directe (80 + 443), rien d'autre.
    assert {port for _, port in published} in ({8082}, {80, 443})


# --- Rate limiting (en dernier : sature la zone export ~1 min) ------------------

def test_export_is_rate_limited_even_with_spoofed_forwarded_for():
    # Chaque requête prétend venir d'une IP différente : sans proxy de confiance
    # déclaré, le WAF doit l'ignorer et compter sur l'IP réelle de connexion.
    statuses = [
        request("POST", "/api/quote/export", params={"format": "html"}, json_body=quote_body(),
                headers={"X-Forwarded-For": f"203.0.113.{i}"})[0]
        for i in range(12)
    ]
    assert 429 in statuses, statuses
