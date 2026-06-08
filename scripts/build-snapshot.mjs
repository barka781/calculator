#!/usr/bin/env node
// Génère le snapshot embarqué du frontend : frontend/src/snapshot.json
//
// Ce fichier est livré dans l'image frontend (copié par le Dockerfile via `src/`)
// et sert de DERNIER repli « plus jamais d'écran vide » : si l'API est injoignable
// au tout premier chargement (aucun cache navigateur encore), le front affiche ce
// snapshot. Il enregistre les réponses BRUTES de l'API (mêmes formes que /health,
// /api/catalog, /api/licenses) pour être re-normalisées côté client exactement
// comme une réponse live.
//
// Usage :
//   node scripts/build-snapshot.mjs                 # interroge http://127.0.0.1:8088
//   node scripts/build-snapshot.mjs http://host:port
//   API_BASE=http://127.0.0.1:8001 node scripts/build-snapshot.mjs
//
// La source par défaut est le proxy Nginx (:8088, même origine que la prod). En dev
// pur sans conteneur, viser le backend directement (:8001).

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "frontend", "src", "snapshot.json");

const BASE = (process.argv[2] || process.env.API_BASE || "http://127.0.0.1:8088").replace(/\/+$/, "");
const LICENSE_PAGE = 1000; // le backend plafonne limit à 1000

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function fetchAllLicenses() {
  const items = [];
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const data = await getJson(`/api/licenses?limit=${LICENSE_PAGE}&skip=${skip}`);
    total = Number(data.total) || items.length;
    (data.items || []).forEach((it) => items.push(it));
    if (!data.items || data.items.length < LICENSE_PAGE) break;
    skip += LICENSE_PAGE;
  }
  return { items, total };
}

async function main() {
  console.log(`[snapshot] source = ${BASE}`);

  const health = await getJson("/health");
  console.log(`[snapshot] /health OK — ${health.catalog_items} produits, ${health.license_items} licences`);

  const catalog = await getJson("/api/catalog?limit=1000&include_deprecated=false");
  console.log(`[snapshot] /api/catalog OK — ${(catalog.items || []).length} items`);

  const licenses = await fetchAllLicenses();
  console.log(`[snapshot] /api/licenses OK — ${licenses.items.length} items`);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: BASE,
    health,
    catalog: { items: catalog.items || [], total: catalog.total ?? (catalog.items || []).length },
    licenses: { items: licenses.items, total: licenses.total },
  };

  await writeFile(OUT, JSON.stringify(snapshot) + "\n", "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  console.log(`[snapshot] écrit → ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} Mo, gzip côté Nginx)`);
}

main().catch((err) => {
  console.error(`[snapshot] échec : ${err.message}`);
  console.error("[snapshot] l'API doit être joignable (ex. `docker compose up -d` puis viser :8088).");
  process.exit(1);
});
