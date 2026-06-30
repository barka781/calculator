from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import os
from urllib.parse import quote_plus


@lru_cache(maxsize=1)
def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def data_root() -> Path:
    configured = os.getenv("CALCULATOR_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return project_root() / "data"


def database_url() -> str:
    """URL SQLAlchemy de la base PostgreSQL.

    Surchargée par la variable d'environnement DATABASE_URL.
    Peut aussi être construite depuis CALCULATOR_POSTGRES_*.
    """
    configured = os.getenv("DATABASE_URL")
    if configured:
        return configured

    user = os.getenv("CALCULATOR_POSTGRES_USER", "calculator")
    password = os.getenv("CALCULATOR_POSTGRES_PASSWORD", "calculator")
    host = os.getenv("CALCULATOR_POSTGRES_HOST", "localhost")
    port = os.getenv("CALCULATOR_POSTGRES_PORT", "5432")
    database = os.getenv("CALCULATOR_POSTGRES_DB", "calculator")
    return (
        "postgresql+psycopg2://"
        f"{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(database)}"
    )


def data_source() -> str:
    """Source de lecture du catalogue : 'db' (PostgreSQL) ou 'yaml'.

    Défaut 'db'. En mode 'db', les loaders se replient automatiquement sur
    les YAML si la base est injoignable ou vide (résilience).
    Non mémorisée pour rester surchargée à chaud (tests).
    """
    return os.getenv("CALCULATOR_SOURCE", "db").strip().lower()


def view_partner() -> bool:
    """Le mode partenaire (remise catalogue) est-il autorisé pour ce déploiement ?

    Piloté par CALCULATOR_VIEW_PARTNER (yes/no). Défaut : NON (prix publics).
    Fait autorité côté serveur : une requête `partner=True` est neutralisée si le
    déploiement ne l'autorise pas (cohérent avec la neutralisation à la source).
    Non mémorisée pour rester surchargeable à chaud (tests).
    """
    raw = os.getenv("CALCULATOR_VIEW_PARTNER", "").strip().lower()
    return raw in ("1", "yes", "true", "on", "oui")


def engagement_discount_scale() -> dict[int, float]:
    """Barème durée d'engagement (mois) → remise % (levier « engagement »).

    Donnée métier INTERNE, fournie HORS dépôt public via
    CALCULATOR_ENGAGEMENT_DISCOUNT_SCALE au format "mois:pct,mois:pct"
    (ex: "1:0,12:5,24:10"). Vide par défaut → aucune remise d'engagement.
    N'a d'effet QU'EN mode partenaire (cf. quote.py / view_partner) : sur un
    déploiement public, le barème est ignoré comme toute remise.
    Non mémorisée pour rester surchargeable à chaud (tests).
    """
    raw = os.getenv("CALCULATOR_ENGAGEMENT_DISCOUNT_SCALE", "").strip()
    scale: dict[int, float] = {}
    if not raw:
        return scale
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        months_str, pct_str = pair.split(":", 1)
        try:
            months = int(months_str.strip())
            pct = float(pct_str.strip())
        except ValueError:
            continue
        if months >= 0 and 0 <= pct <= 100:
            scale[months] = pct
    return scale


def calculator_version() -> str:
    configured = os.getenv("CALCULATOR_VERSION")
    if configured and configured.strip():
        return configured.strip()

    candidates = (
        project_root().parent / "Version",
        project_root() / "Version",
        Path("/app/Version"),
    )
    for candidate in candidates:
        try:
            value = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return "0.1.0"


def sync_poll_interval_seconds() -> int:
    """Intervalle de synchro automatique QuoteFlow -> calculator.

    Défaut produit : 15 minutes. Mettre 0 pour désactiver le polling automatique
    (utile en tests ou en maintenance).
    """
    raw = os.getenv("CALCULATOR_SYNC_POLL_INTERVAL_SECONDS", "900").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 900


def live_git_url() -> str | None:
    value = os.getenv("CALCULATOR_LIVE_GIT_URL")
    return value.strip() if value and value.strip() else None


def live_git_ref() -> str:
    return os.getenv("CALCULATOR_LIVE_GIT_REF", "main").strip() or "main"


@lru_cache(maxsize=1)
def live_git_cache_dir() -> Path:
    configured = os.getenv("CALCULATOR_LIVE_GIT_CACHE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return data_root() / "_live_quoteflow"


def live_git_enabled() -> bool:
    return live_git_url() is not None


def catalogs_dir() -> Path:
    return data_root() / "CATALOGS"


def licences_file() -> Path:
    return data_root() / "LICENCES" / "licences.yaml"


@lru_cache(maxsize=1)
def quoteflow_root() -> Path:
    configured = os.getenv("CALCULATOR_QUOTEFLOW_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    # Dev : .../Quoteflow/calculator/backend → QuoteFlow voisin .../Quoteflow/quoteflow.
    # Conteneur / arborescence plate (project_root == /app) : pas de voisin ;
    # on évite l'IndexError et on renvoie un chemin (inexistant) cohérent, ce qui
    # marque simplement la source live comme indisponible.
    parents = project_root().parents
    base = parents[1] if len(parents) >= 2 else project_root()
    return base / "quoteflow"


def source_root() -> Path:
    if live_git_enabled():
        return live_git_cache_dir()
    return quoteflow_root()


def source_catalogs_dir() -> Path:
    configured = os.getenv("CALCULATOR_SOURCE_CATALOGS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return source_root() / "CATALOGS"


def source_licences_dir() -> Path:
    configured = os.getenv("CALCULATOR_SOURCE_LICENCES_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return source_root() / "LICENCES"


# --------------------------------------------------------------------------- #
# Liaison API QuoteFlow (source live « définitive »)
#
# PRÉPARATION : la tuyauterie HTTP est prête. L'URL réelle et le format exact
# de l'API QuoteFlow restent à confirmer — d'où des défauts paramétrables et
# une liaison DÉSACTIVÉE tant que CALCULATOR_QUOTEFLOW_API_URL n'est pas définie
# (repli automatique sur la source fichiers/git existante).
# --------------------------------------------------------------------------- #
def quoteflow_api_url() -> str | None:
    """URL de base de l'API REST QuoteFlow (ex : https://quoteflow.example).

    Non définie -> liaison API désactivée (repli sur la source fichiers/git).
    """
    value = os.getenv("CALCULATOR_QUOTEFLOW_API_URL")
    return value.strip().rstrip("/") if value and value.strip() else None


def quoteflow_api_enabled() -> bool:
    """True si une URL d'API QuoteFlow est configurée."""
    return quoteflow_api_url() is not None


def quoteflow_api_token() -> str | None:
    """Jeton Bearer optionnel pour l'API QuoteFlow."""
    value = os.getenv("CALCULATOR_QUOTEFLOW_API_TOKEN")
    return value.strip() if value and value.strip() else None


def quoteflow_api_timeout_seconds() -> float:
    """Timeout HTTP par requête vers l'API QuoteFlow (défaut 20 s)."""
    raw = os.getenv("CALCULATOR_QUOTEFLOW_API_TIMEOUT_SECONDS", "20").strip()
    try:
        value = float(raw)
    except ValueError:
        return 20.0
    return value if value > 0 else 20.0


def quoteflow_api_page_size() -> int:
    """Taille de page pour la pagination des listes (défaut 500)."""
    raw = os.getenv("CALCULATOR_QUOTEFLOW_API_PAGE_SIZE", "500").strip()
    try:
        value = int(raw)
    except ValueError:
        return 500
    return value if value > 0 else 500


def quoteflow_api_products_path() -> str:
    """Chemin de l'endpoint catalogue côté API QuoteFlow.

    TODO(API réelle) : confirmer le chemin exact (cf. routers QuoteFlow).
    """
    raw = os.getenv("CALCULATOR_QUOTEFLOW_API_PRODUCTS_PATH", "/api/catalog").strip()
    return raw or "/api/catalog"


def quoteflow_api_licenses_path() -> str:
    """Chemin de l'endpoint licences côté API QuoteFlow.

    TODO(API réelle) : confirmer le chemin exact (cf. routers QuoteFlow).
    """
    raw = os.getenv("CALCULATOR_QUOTEFLOW_API_LICENSES_PATH", "/api/licenses").strip()
    return raw or "/api/licenses"
