# Cloud Temple Calculator

Application autonome extraite de QuoteFlow pour calculer des paniers Cloud Temple
depuis les catalogues et licences YAML.

## Structure

```text
backend/   FastAPI + core de calcul Python pur
frontend/  SPA statique HTML/CSS/JS
scripts/   outils de développement
```

Le projet ne dépend pas de la base QuoteFlow, de Qdrant, de Gemini ou de
l'authentification QuoteFlow.

## Lancement local

Depuis la racine du depot :

```bash
npm start
```

Le lanceur démarre :

- le backend FastAPI sur `http://127.0.0.1:8001`
- le frontend statique sur `http://127.0.0.1:4173`

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
- `POST /api/quote`
- `POST /api/architecture/calculate`

## Tests

```bash
cd backend
python -m pytest
```
