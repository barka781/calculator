# Audit Jalon — 2026-06-07

> Audit des deux derniers jalons du **2026-06-06**, croisé entre la mémoire
> partagée Live Memory (espace `calculator`) et l'état réel des fichiers/Git.
> Auteur : Claude Code (Opus 4.8). Owner : Aymerick Lesur (Cloud Temple).

---

## 1. Périmètre audité

- **Jalon A** — Refonte UI panier/catalogue + correctif stabilité dev (crash
  uvicorn) + diagnostic « catalogue hors ligne ».
- **Jalon B** — Migration du workspace hors iCloud (clone Git officiel).

Base d'audit : mémoire Live Memory **et** inspection du code réel (deux
emplacements : workspace iCloud `Documents/ALL/.../Quoteflow` et clone hors
iCloud `~/dev/Quoteflow/calculator`).

---

## 2. Ce qui a été fait (en bref)

### Jalon A
- ✅ Refonte UI panier/catalogue : **commitée** (`d7edf35`), `node --check` OK.
- 🔶 Correctif crash uvicorn : fait *et amélioré* — passé de `--reload-dir app`
  à un **auto-reload opt-in** (`WATCH=1`, désactivé par défaut). Était **non
  commité** avant cet audit.
- 🔶 Diagnostic « catalogue hors ligne » : cause comprise (localStorage
  prioritaire), mais **aucune correction dans le code**.

### Jalon B
- 🔶 Clone Git officiel créé hors iCloud, sain, même `origin`.
- ➕ Bonus non documenté en mémoire : la **sync vivante** (priorité HAUTE) a été
  amorcée dans ce clone, de bonne qualité — mais **non commitée** avant audit.

---

## 3. Erreurs commises

| # | Gravité | Erreur | Preuve |
|---|---------|--------|--------|
| 1 | 🔴 | **Migration hors iCloud non adoptée.** Le travail continuait dans iCloud : workspace courant `Documents/ALL/.../Quoteflow`, `dev-start.js` modifié le 2026-06-07. | mtime + `git status` |
| 2 | 🔴 | **Problème iCloud toujours actif.** Fichiers clés `compressed,dataless` : `app.js`, `styles.css`, `dev-start.js`, `db.py`, `ingest.py`, `export.py`, `db_models.py`, `architecture.py`. → risque I/O errno 89 intact. | `stat -f %Sf` |
| 3 | 🔴 | **Split-brain de working tree, rien commité.** Deux clones, deux chantiers différents non sauvegardés : iCloud = `dev-start.js` ; hors iCloud = sync vivante (`config.py`, `main.py`, `sync.py`, `test_sync.py`, `.gitignore`, `backend/README.md`). Même `origin` → conflit garanti + risque de perte (aggravé par dataless). | `git status` des 2 repos |
| 4 | 🟠 | **Cause racine « catalogue hors ligne » non corrigée.** `app.js` : le `catch` de `/health` met `online=false` sans **repli auto** sur `http://127.0.0.1:8001` quand l'URL `localStorage.calculatorApiBase` est invalide. Le piège peut récidiver. | `app.js:5-8`, `:390-396` |
| 5 | 🟡 | **Résidu non nettoyé** : `~/dev/Quoteflow/calculator-partial-icloud-copy/` (avec son `.git`) traîne. | `ls` |
| 6 | 🟡 | **Mémoire désynchronisée du réel.** Disait « correctif = `--reload-dir app` » (devenu `WATCH=1`) et ignorait le chantier sync vivante + le split-brain. | comparaison mémoire/code |
| — | ⚪ | **Faux positif iCloud** : `README.md` apparaît `modified` dans `git status` alors que son contenu est identique (re-matérialisation → `mtime` change). Symptôme, pas une faute. | `git diff --numstat` vide |

---

## 4. Cause profonde commune

Les erreurs 1→3 ont **une seule racine** : la migration hors iCloud a été
*commencée* (clone créé) mais **jamais finalisée** — pas de bascule du
workspace, pas de commit, pas de nettoyage. D'où deux copies vivantes, du
travail non sauvegardé, et le problème iCloud d'origine toujours présent.

---

## 5. Point positif (contexte ANSSI / souveraineté)

La sync vivante hors iCloud est bien conçue : `_redact_url()` **masque les
credentials** dans les métadonnées (`https://[redacted]@…`), timeout git,
source maîtrisée configurée par variable d'environnement
(`CALCULATOR_LIVE_GIT_URL`). Bon réflexe sécurité. Reste à finaliser et tester.

---

## 6. Actions RÉALISÉES ce jour (2026-06-07)

### Action #1 — Sécuriser le travail non commité (double filet)
- Patch iCloud exporté **hors iCloud** :
  `~/dev/Quoteflow/icloud-uvicorn-readme-20260607.patch` (correctif uvicorn).
- Repo iCloud : branche **`wip/uvicorn-rescue-20260607`**, commit **`bfa0b83`**
  (sauvegarde du correctif uvicorn).
- Clone hors iCloud : branche **`feat/live-sync-consolidation`**, commit
  **`51c392d`** (sync vivante sauvegardée). `py_compile` OK.

### Action #2 — Consolider sur une source unique (clone hors iCloud)
- Correctif uvicorn rapatrié via patch (`git apply`, `node --check` OK),
  commit **`0e9f8a4`** sur `feat/live-sync-consolidation`.
- **Source unique de vérité** = `~/dev/Quoteflow/calculator`, branche
  `feat/live-sync-consolidation` :
  `0e9f8a4` (uvicorn) → `51c392d` (sync vivante) → `d7edf35` (= origin/main).
- Workspace iCloud **déprécié** (non supprimé) : `calculator/MOVED.md`,
  commit **`f777b67`** sur `wip/uvicorn-rescue-20260607`.

> ⚠️ Tout est **local** : aucun `git push` effectué (non demandé).
> ⚠️ Identité git auto-configurée dans le clone hors iCloud
> (`aymericklsr@air-de-lesur.home`) — à fixer si besoin avant push.

---

## 7. Reste à faire (réparation prioritaire)

1. 🔴 **Valider la branche `feat/live-sync-consolidation`** : `pytest` complet
   (cible 13+ passed), puis merge sur `main` et `git push`.
2. 🟠 **Finir la sync vivante** (config `CALCULATOR_LIVE_GIT_URL` réelle, test
   bout en bout du `/api/sync/catalog?refresh`).
3. 🟠 **Corriger le repli auto API** dans `app.js` (erreur #4) : retomber sur
   `http://127.0.0.1:8001` si l'URL mémorisée ne répond pas.
4. 🟡 **Supprimer le résidu** `calculator-partial-icloud-copy/`.
5. 🟡 **Décider du sort du workspace iCloud** (suppression à confirmer).
6. 🟡 **Fixer l'identité git** du clone hors iCloud avant le prochain push.
