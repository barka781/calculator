# Cloud Temple Calculator

Application autonome extraite de QuoteFlow pour calculer des paniers Cloud Temple
depuis les catalogues et licences YAML.

## Etat du périmètre

Le périmètre stable couvre aujourd'hui le MVP catalogue + licences + panier/devis.
Les calculateurs architecture, infogérance et appliances existent côté API, mais
restent des versions simplifiées à revoir avant de les considérer comme une
extraction complète de QuoteFlow.

## Structure

```text
Version    version courante de l'application (bump en fin de session)
backend/   FastAPI + core de calcul Python pur
frontend/  SPA statique HTML/CSS/JS
scripts/   outils de développement
```

Le projet ne dépend pas de la base QuoteFlow, de Qdrant, de Gemini ou de
l'authentification QuoteFlow.

## Version

La version courante est stockée dans `Version`. Elle est aussi exposée par
`GET /health` et copiée dans les images Docker. À chaque fin de session de
travail, bumper ce fichier (et garder `package.json` aligné quand il change).

## Lancement local

Depuis la racine du depot :

```bash
npm start
```

Le lanceur démarre :

- le backend FastAPI sur `http://127.0.0.1:8001`
- le frontend statique sur `http://127.0.0.1:4173`

## Déploiement (Docker)

Le stack complet (Nginx → API FastAPI → PostgreSQL) se lance via Docker Compose :

```bash
export CALCULATOR_POSTGRES_PASSWORD='valeur-longue-a-remplacer'
docker compose up -d --build
```

Docker Compose lit aussi automatiquement un fichier `.env` local (ignoré par git).
Un modèle non secret est fourni dans `.env.example`.

L'application est alors servie sur `http://localhost:8088` (port côté hôte
configurable dans `docker-compose.yml`, service `frontend`).

Architecture (3 services) :

- **`frontend`** (Nginx non-root, port hôte `8088` → `8080`) : sert le frontend statique et relaie `/api/*`
  et `/health` vers l'API. Tout passe par une seule origine → ni CORS, ni URL
  d'API à configurer côté navigateur (`config.js` est résolu à `window.location.origin`).
- **`backend`** (FastAPI non-root) : l'API. Au démarrage, attend PostgreSQL puis ingère les
  YAML embarqués. Aucune de ces étapes ne bloque le service : en cas de base
  injoignable, l'API se replie automatiquement sur les YAML (disponibilité d'abord).
- **`database`** (PostgreSQL 16 Alpine) : la base, données persistées dans le volume `calculator_pgdata`.
  Aucun port PostgreSQL n'est publié sur l'hôte.

Pour une VM derrière un reverse proxy : n'exposer publiquement que le service
`frontend` (mapper `8088:8080` ou pointer le proxy dessus) ; `backend` et
`database` restent sur le réseau interne du compose.

Arrêt / logs :

```bash
docker compose logs -f          # suivre les journaux
docker compose down             # arrêter (volume conservé)
docker compose down -v          # arrêter et supprimer les données
```

## Backend seul

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Endpoints principaux :

- `GET /health`
- `GET /api/catalog`
- `GET /api/catalog/{sku}`
- `GET /api/licenses`
- `GET /api/licenses/{sku}`
- `GET /api/sync/status`
- `POST /api/sync/catalog`
- `POST /api/quote`
- `POST /api/architecture/calculate`
- `POST /api/managed-services/calculate`
- `POST /api/appliances/{appliance_type}/offer`

Le schéma JSON détaillé des endpoints est documenté dans
`backend/README.md`.

## Tests

```bash
cd backend
python -m pytest
```
