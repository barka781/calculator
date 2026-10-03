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
`GET /health`, copiée dans les images Docker et affichée dans le pied de page du
frontend. À chaque fin de session de travail, bumper ce fichier (et garder
`package.json` aligné quand il change).

## Lancement local

Depuis la racine du depot :

```bash
npm start
```

Le lanceur démarre :

- le backend FastAPI sur `http://127.0.0.1:8001`
- le frontend statique sur `http://127.0.0.1:4173`

## Déploiement (Docker)

Le stack complet suit les conventions du
[Cloud-Temple/starter-kit](https://github.com/Cloud-Temple/starter-kit) :
un WAF Caddy + Coraza est la **seule porte d'entrée** publique.

```text
Internet → waf (Caddy + Coraza OWASP CRS, rate limiting) → frontend (Nginx)
         → backend (FastAPI) → database (PostgreSQL)
```

### Procédure (agent ou administrateur de déploiement)

```bash
git clone https://github.com/barka781/calculator.git && cd calculator
cp .env.example .env
# Renseigner au minimum CALCULATOR_POSTGRES_PASSWORD (openssl rand -hex 32).
# Déploiement public : garder CALCULATOR_VIEW_PARTNER=no et le barème vide.
docker compose up -d --build --wait
curl -fsS http://localhost:8088/health
```

`--wait` rend la main quand les quatre services sont `healthy`. Le
healthcheck du WAF traverse toute la chaîne (WAF → Nginx → API → base).

### Exposition et TLS

Seul le service `waf` publie un port (`WAF_PORT`, défaut `8088`). Deux modes,
réglés par `SITE_ADDRESS` dans `.env` :

- **Derrière un reverse proxy TLS amont** (ou en local) : `SITE_ADDRESS=:8082`
  (défaut). Le proxy amont pointe sur `http://<hôte>:8088`.
  Déclarer alors l'adresse du proxy dans `TRUSTED_PROXIES`, sinon toutes les
  requêtes semblent venir du proxy et le rate limiting par IP devient commun à
  tous les visiteurs.
- **TLS direct** : `SITE_ADDRESS=calculator.cloud-temple.app` (DNS pointé sur
  l'hôte), puis lancer avec la surcouche qui publie les ports 80 et 443 :

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build --wait
  ```

  Caddy obtient et renouvelle le certificat Let's Encrypt.

### Ce que le WAF laisse passer

L'API publique est une **liste blanche** des routes utilisées par l'interface :
`GET /api/catalog*`, `GET /api/licenses*`, `POST /api/quote`,
`POST /api/quote/export`, plus `/health` et les fichiers statiques. Toute autre
route `/api` (synchro, architecture, infogérance, appliances) répond `404`
depuis l'extérieur ; nginx refuse en plus `/api/sync/` (défense en profondeur,
cette route n'a pas d'authentification). Le WAF bloque aussi les attaques OWASP courantes (`403`),
les corps de requête de plus de 1 Mio (`413`) et limite le débit par IP
(`429`) : 300 req/min au total, 120 sur l'API, 10 exports par minute.

Les en-têtes de sécurité (CSP, HSTS, X-Frame-Options…) sont posés par le WAF
uniquement (`waf/Caddyfile`). `waf/Dockerfile` est repris tel quel du
starter-kit : le resynchroniser depuis le kit plutôt que de le modifier.

### Services internes

- **`frontend`** (Nginx non-root) : sert le frontend statique et relaie `/api/*`
  et `/health` vers l'API. Tout passe par une seule origine → ni CORS, ni URL
  d'API à configurer côté navigateur (`config.js` est résolu à `window.location.origin`).
- **`backend`** (FastAPI non-root) : l'API. Au démarrage, attend PostgreSQL puis ingère les
  YAML embarqués. Aucune de ces étapes ne bloque le service : en cas de base
  injoignable, l'API se replie automatiquement sur les YAML (disponibilité d'abord).
  La synchronisation QuoteFlow est lancée au démarrage puis relancée toutes les
  15 minutes par défaut (`CALCULATOR_SYNC_POLL_INTERVAL_SECONDS=900`).
- **`database`** (PostgreSQL 16 Alpine) : données persistées dans le volume `calculator_pgdata`.

### Exploitation

```bash
docker compose logs -f waf      # journaux du WAF (JSON), dont les blocages
docker compose logs -f          # tous les journaux
docker compose down             # arrêter (volumes conservés)
docker compose down -v          # arrêter et supprimer les données
```

Pour suspendre temporairement la synchronisation automatique :

```bash
CALCULATOR_SYNC_POLL_INTERVAL_SECONDS=0 docker compose up -d
```

## Backend seul

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Endpoints principaux (en direct sur le backend ; derrière le WAF, seuls
catalogue, licences, devis, export et `/health` sont publics) :

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
# Backend (calcul, catalogue, synchro, exports)
cd backend && python -m pytest

# Frontend (logique de devis, données hors ligne)
npm run test:frontend

# Bout en bout, sur la stack Docker démarrée (WAF, liste blanche, attaques,
# exposition réseau, rate limiting). Ignorés sans CALCULATOR_E2E_URL.
CALCULATOR_E2E_URL=http://localhost:8088 backend/.venv/bin/python -m pytest tests/e2e -v
```
