# Cloud Temple Calculator Backend

Backend API public du calculateur Cloud Temple.

## Installation

```bash
cd calculator/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Lancement

```bash
uvicorn app.main:app --reload --port 8000
```

## Endpoints MVP

- `GET /health`
- `GET /api/catalog`
- `GET /api/catalog/{sku}`
- `GET /api/licenses`
- `GET /api/licenses/{sku}`
- `POST /api/quote`
- `POST /api/architecture/calculate`

Le backend lit directement les YAML copiés dans `data/CATALOGS` et `data/LICENCES`. Il ne dépend pas de la DB QuoteFlow, de Qdrant, de l'auth QuoteFlow ou de Gemini.
