# Audit Jalon — 2026-06-08

> Audit post-push du Cloud Temple Calculator après les commits `09b484f`
> et `9350ea9` sur `origin/main`.
>
> Objectif : garder une lecture simple par périmètre :
> **Frontend**, **Backend**, puis **Docker / autres**.

---

## Synthèse

### État publié

- `09b484f` — repli hors-ligne "plus jamais d'écran vide" + panneau financier redimensionnable.
- `9350ea9` — stack Docker complète, version runtime, durcissements initiaux, tests frontend.
- Branche `main` synchronisée avec `origin/main`.
- Version applicative courante : `0.1.2` via le fichier `Version`.

### Validation réalisée

- `docker compose up -d --build` OK avec `CALCULATOR_POSTGRES_PASSWORD=dev-change-me`.
- Conteneurs `database`, `backend`, `frontend` healthy.
- `GET /health` via `http://localhost:8088` OK, avec `version: "0.1.2"`.
- `GET /Version` OK.
- `GET /api/catalog?limit=1` OK.
- `GET /config.js` OK, same-origin.
- `GET /src/snapshot.json` OK avec headers sécurité.
- Tests backend : 17 passed.
- Tests frontend : 4 passed.
- `git diff --check` OK.

---

## 1. Frontend

### Livré

- Cascade de repli des données : live API -> cache navigateur -> snapshot embarqué.
- Cache navigateur versionné via `frontend/src/offline-data.js`.
- Snapshot embarqué `frontend/src/snapshot.json` utilisé comme dernier recours.
- Calcul local de devis en repli via `frontend/src/quote-core.js` si `POST /api/quote` échoue.
- Panneau financier redimensionnable :
  - variable CSS `--summary-w`,
  - clamp 360-820 px,
  - poignée de glissement,
  - presets S/M/L,
  - double-clic reset,
  - persistance `localStorage` seulement au relâchement.
- `config.js` charge l'API sur `window.location.origin` en mode Docker.
- Tests frontend Node natifs :
  - cache valide prioritaire sur snapshot,
  - cache sans version rejeté,
  - calcul local avec remises standard + commerciale,
  - fallback engagement à 1 mois.

### Points corrigés depuis l'audit initial

- B1 — calcul hors-ligne du devis : corrigé par `quote-core.js`.
- B2 — écriture `localStorage` pendant chaque frame de drag : corrigé, persistance au `pointerup`.
- B3 — `dataStale` non exploité : corrigé, pilote le rendu de repli.
- B4 — snapshot chargé même si cache valide : corrigé par `chooseOfflineData`.
- B5 — absence de tests frontend : corrigé avec 4 tests ciblés.
- Q2 — cache sans versionnage : corrigé avec `CACHE_VERSION`.

### À surveiller

- Accessibilité clavier de la poignée de redimensionnement : encore perfectible.
- Snapshot public avec catalogue + licences : choix assumé pour le repli, mais à revalider avant exposition large si des prix deviennent sensibles.
- Fraîcheur du snapshot : régénération manuelle via `node scripts/build-snapshot.mjs`; prévoir un garde-fou CI ou une alerte de fraîcheur plus tard.

---

## 2. Backend

### Livré

- API FastAPI inchangée fonctionnellement pour le calcul principal.
- Lecture de la version applicative via `calculator_version()` :
  - priorité à `CALCULATOR_VERSION`,
  - fallback sur le fichier `Version`,
  - fallback ultime `0.1.0`.
- FastAPI utilise cette version dans son metadata OpenAPI.
- `GET /health` expose désormais `version`.
- `database_url()` construit l'URL PostgreSQL depuis `CALCULATOR_POSTGRES_*`.
- `quoteflow_root()` est robuste en arborescence plate de conteneur (`/app`) et ne déclenche plus d'`IndexError`.
- Entrypoint Docker backend :
  - attente PostgreSQL best-effort,
  - ingestion YAML best-effort,
  - démarrage API même si la BDD est indisponible grâce au repli YAML.

### Validation

- `CALCULATOR_SOURCE=yaml .venv/bin/python -m pytest` depuis `backend/` : 17 passed.
- `PYTHONPYCACHEPREFIX=/tmp/calculator-pycache python3 -m py_compile backend/app/config.py backend/app/main.py` OK.
- `/health` en conteneur :
  - `data_source: db`,
  - `catalog_items: 136`,
  - `license_items: 8834`,
  - `version: 0.1.2`.

### À surveiller

- La source live QuoteFlow n'est pas encore branchée en conteneur : `source_available: false` est normal pour l'instant.
- Prochaine cible produit : API QuoteFlow -> calculator, sync au démarrage puis polling toutes les 15 minutes.
- Le bouton manuel de synchronisation devra être retiré/masqué du parcours public cible.

---

## 3. Docker / autres

### Livré

- Stack Compose complète :
  - `frontend` : Nginx non-root, frontend statique, reverse-proxy `/api/*` et `/health`,
  - `backend` : FastAPI non-root,
  - `database` : PostgreSQL 16 Alpine.
- Same-origin via Nginx : pas de CORS côté navigateur en production Docker.
- Port public local : `8088:8080` uniquement sur `frontend`.
- Aucun port PostgreSQL publié sur l'hôte.
- Mot de passe PostgreSQL requis via `CALCULATOR_POSTGRES_PASSWORD`.
- `.env.example` ajouté sans secret réel.
- `.gitignore` ignore `.env` et `.env.local`.
- Headers sécurité Nginx :
  - Content-Security-Policy,
  - X-Content-Type-Options,
  - X-Frame-Options,
  - Referrer-Policy,
  - HSTS.
- Gzip activé pour CSS, JS, JSON.
- `Version` copié dans :
  - `/app/Version` côté backend,
  - `/usr/share/nginx/html/Version` côté frontend.
- `.dockerignore` racine ajouté pour limiter le contexte de build.

### Validation

- `CALCULATOR_POSTGRES_PASSWORD=dev-change-me docker compose config` OK.
- `CALCULATOR_POSTGRES_PASSWORD=dev-change-me docker compose up -d --build` OK.
- `docker compose ps` :
  - `calculator-database` healthy,
  - `calculator-backend` healthy,
  - `calculator-frontend` healthy.
- `curl http://localhost:8088/health` OK.
- `curl http://localhost:8088/Version` -> `0.1.2`.
- `curl -I http://localhost:8088/src/snapshot.json` -> 200 + headers sécurité.

### À surveiller

- Ressources conteneurs : pas encore de limites CPU/mémoire.
- Nginx upstream `backend:8001` reste simple ; si `backend` est recréé avec nouvelle IP, un reload Nginx peut être nécessaire. À durcir plus tard avec resolver Docker (`127.0.0.11`) si besoin prod.
- Le fichier `.env` réel n'est pas versionné : chaque environnement doit définir `CALCULATOR_POSTGRES_PASSWORD`.
- La stack a été laissée démarrée localement sur `http://localhost:8088` après validation.

---

## Décision

Le périmètre publié est cohérent pour poursuivre vers le déploiement public.

Avant exposition publique, les derniers sujets à cadrer sont :

1. Secret réel PostgreSQL et injection propre côté VM/CI.
2. Confirmation que le snapshot public ne contient pas de tarif confidentiel.
3. Branchement de la source live définitive QuoteFlow -> calculator.
4. Retrait/masquage du bouton manuel de synchronisation dans l'UI publique cible.
5. Garde-fou de fraîcheur du snapshot ou génération contrôlée avant release.
