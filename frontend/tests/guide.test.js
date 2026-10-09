const test = require("node:test");
const assert = require("node:assert/strict");

const G = require("../src/guide.js");

// Stockage en mémoire, au contrat de localStorage (valeurs en chaînes).
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}
const brokenStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

const run = (g, ...actions) => actions.reduce((s, a) => G.reduceGuide(s, typeof a === "string" ? { type: a } : a), g);
const firstVisit = () => G.initialGuide(G.readPrefs(memoryStorage()));

test("préférences : première visite par défaut, mode inconnu ramené à guidé", () => {
  assert.deepEqual(G.readPrefs(memoryStorage()), { onboarded: false, mode: "guided" });
  assert.deepEqual(G.readPrefs(memoryStorage({ [G.MODE_KEY]: "admin" })), { onboarded: false, mode: "guided" });
  assert.deepEqual(G.readPrefs(memoryStorage({ [G.ONBOARDED_KEY]: "1", [G.MODE_KEY]: "free" })), { onboarded: true, mode: "free" });
  // Seule la valeur exacte « 1 » vaut visite passée : pas de « true » ou « 0 » interprété au hasard.
  assert.equal(G.readPrefs(memoryStorage({ [G.ONBOARDED_KEY]: "0" })).onboarded, false);
});

test("préférences : un stockage qui lève ne casse ni la lecture ni l'écriture", () => {
  assert.deepEqual(G.readPrefs(brokenStorage), { onboarded: false, mode: "guided" });
  assert.doesNotThrow(() => G.savePrefs(brokenStorage, { onboarded: true, mode: "free" }));
});

test("préférences : aller-retour écriture → lecture, mode invalide jamais écrit", () => {
  const s = memoryStorage();
  G.savePrefs(s, { onboarded: true, mode: "free" });
  assert.deepEqual(G.readPrefs(s), { onboarded: true, mode: "free" });
  G.savePrefs(s, { onboarded: true, mode: "n'importe quoi" });
  assert.equal(s.data[G.MODE_KEY], "free");
});

test("première visite : l'assistant s'ouvre sur le choix guidé / libre ; visite suivante : fermé", () => {
  assert.deepEqual(firstVisit(), { open: true, step: G.ENTRY, fromResult: false, revealed: false });
  const back = G.initialGuide({ onboarded: true, mode: "guided" });
  assert.equal(back.open, false);
  assert.equal(back.revealed, true); // un habitué ne revoit jamais la révélation
});

test("parcours complet de première visite : entrée → 1 → 2 → 3 → révélation → app", () => {
  let g = run(firstVisit(), "pickGuided");
  assert.equal(g.step, 1);
  g = run(g, "next", "next");
  assert.equal(g.step, 3);
  g = run(g, "next");
  assert.equal(g.step, G.REVEAL);
  assert.equal(g.open, true);
  g = run(g, "revealDone");
  assert.deepEqual(g, { open: false, step: G.REVEAL, fromResult: false, revealed: true });
});

test("devis libre dès l'entrée, ou « Passer » : l'assistant se ferme sans révélation", () => {
  assert.equal(run(firstVisit(), "pickFree").open, false);
  assert.equal(run(firstVisit(), "pickGuided", "next", "skip").open, false);
  assert.equal(run(firstVisit(), "pickFree").revealed, false);
});

test("relance depuis le résultat (pastille) : « suivant » ramène au résultat sans repasser les étapes", () => {
  const onboarded = G.initialGuide({ onboarded: true, mode: "guided" });
  const g = run(onboarded, { type: "open", step: 2, fromResult: true });
  assert.equal(g.step, 2);
  const after = run(g, "next");
  assert.equal(after.open, false);
  assert.equal(after.fromResult, false);
});

test("« Me guider pas à pas » : refait les 3 étapes mais ne rejoue pas la révélation", () => {
  const onboarded = G.initialGuide({ onboarded: true, mode: "guided" });
  const g = run(onboarded, { type: "open", step: 1 }, "next", "next");
  assert.equal(g.step, 3);
  const after = run(g, "next");
  assert.equal(after.open, false);
  assert.notEqual(after.step, G.REVEAL);
});

test("retour : vers l'entrée en première visite, fermeture sinon", () => {
  assert.equal(run(firstVisit(), "pickGuided", "back").step, G.ENTRY);
  const onboarded = G.initialGuide({ onboarded: true, mode: "guided" });
  assert.equal(run(onboarded, { type: "open", step: 1 }, "back").open, false);
  assert.equal(run(onboarded, { type: "open", step: 3 }, "back").step, 2);
});

test("barre d'étapes : seules les étapes franchies sont atteignables", () => {
  const at3 = run(firstVisit(), "pickGuided", "next", "next");
  assert.equal(run(at3, { type: "goto", step: 1 }).step, 1);
  assert.equal(run(at3, { type: "goto", step: 3 }), at3); // étape courante : inchangé
  const at1 = run(firstVisit(), "pickGuided");
  assert.equal(run(at1, { type: "goto", step: 3 }), at1); // pas de saut en avant
  const reveal = run(at3, "next");
  assert.equal(run(reveal, { type: "goto", step: 1 }), reveal); // pas d'échappée pendant la révélation
});

test("ouverture : étape bornée entre 1 et 3", () => {
  const closed = G.initialGuide({ onboarded: true, mode: "guided" });
  assert.equal(run(closed, { type: "open", step: 9 }).step, 3);
  assert.equal(run(closed, { type: "open", step: -2 }).step, 1);
  assert.equal(run(closed, { type: "open" }).step, 1);
});

test("actions hors contexte : état inchangé (même objet)", () => {
  const closed = G.initialGuide({ onboarded: true, mode: "guided" });
  for (const type of ["next", "back", "pickGuided", "pickFree", "skip", "revealDone", "inconnue"]) {
    assert.equal(G.reduceGuide(closed, { type }), closed, type);
  }
  const entry = firstVisit();
  assert.equal(G.reduceGuide(entry, { type: "next" }), entry); // l'entrée exige un choix explicite
  const reveal = run(entry, "pickGuided", "next", "next", "next");
  assert.equal(G.reduceGuide(reveal, { type: "back" }), reveal);
});

// Marche aléatoire : quelles que soient les actions, les invariants tiennent.
test("invariants sur 5 000 séquences aléatoires d'actions", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const actions = [
    () => ({ type: "open", step: Math.floor(rand() * 5) - 1, fromResult: rand() < 0.5 }),
    () => ({ type: "pickGuided" }),
    () => ({ type: "pickFree" }),
    () => ({ type: "skip" }),
    () => ({ type: "next" }),
    () => ({ type: "next" }), // deux fois plus probable : la révélation doit être atteinte souvent
    () => ({ type: "back" }),
    () => ({ type: "goto", step: Math.floor(rand() * 5) }),
    () => ({ type: "revealDone" }),
  ];
  for (let i = 0; i < 5000; i++) {
    let g = rand() < 0.5 ? firstVisit() : G.initialGuide({ onboarded: true, mode: "guided" });
    let reveals = 0;
    for (let k = 0; k < 60; k++) {
      const prev = g;
      g = G.reduceGuide(g, actions[Math.floor(rand() * actions.length)]());
      assert.ok(g.step >= G.ENTRY && g.step <= G.REVEAL, `étape hors bornes : ${g.step}`);
      assert.ok(g.open || !g.fromResult, "fermé mais encore « depuis le résultat »");
      assert.ok(!prev.revealed || g.revealed, "la révélation est redevenue à jouer");
      if (g.step === G.REVEAL && prev.step !== G.REVEAL) reveals += 1;
      if (g.step === G.REVEAL && g.open) assert.equal(g.revealed, false, "révélation rejouée");
    }
    assert.ok(reveals <= 1, `révélation jouée ${reveals} fois`);
  }
});

test("pendant la révélation : ni relance ni passage ne permettent de la rejouer", () => {
  const reveal = run(firstVisit(), "pickGuided", "next", "next", "next");
  assert.equal(reveal.step, G.REVEAL);
  assert.equal(G.reduceGuide(reveal, { type: "open", step: 1 }), reveal);
  const skipped = run(reveal, "skip");
  assert.equal(skipped.open, false);
  assert.equal(skipped.revealed, true);
  assert.notEqual(run(skipped, { type: "open", step: 1 }, "next", "next", "next").step, G.REVEAL);
});

test("empreinte de panier : indépendante de l'ordre, sensible à la quantité et à la source", () => {
  const a = [{ sku: "x", source: "catalog", quantity: 2 }, { sku: "y", source: "license", quantity: 1 }];
  const b = [a[1], a[0]];
  assert.equal(G.cartSignature(a), G.cartSignature(b));
  assert.notEqual(G.cartSignature(a), G.cartSignature([{ ...a[0], quantity: 3 }, a[1]]));
  assert.notEqual(G.cartSignature(a), G.cartSignature([a[0], { ...a[1], source: "catalog" }]));
  assert.equal(G.cartSignature([]), "");
  assert.equal(G.cartSignature(null), "");
});

test("garde de remplacement : confirmation seulement si le devis a été modifié à la main", () => {
  const chosen = [{ sku: "vcpu", source: "catalog", quantity: 24 }, { sku: "tenant", source: "catalog", quantity: 1 }];
  const sig = G.cartSignature(chosen);
  assert.equal(G.replaceGuard([], sig), "replace"); // devis vide
  assert.equal(G.replaceGuard([], ""), "replace");
  assert.equal(G.replaceGuard([...chosen].reverse(), sig), "replace"); // simple changement d'offre
  assert.equal(G.replaceGuard([...chosen, { sku: "s3", source: "catalog", quantity: 1 }], sig), "confirm"); // produit ajouté
  assert.equal(G.replaceGuard([{ ...chosen[0], quantity: 30 }, chosen[1]], sig), "confirm"); // quantité modifiée
  assert.equal(G.replaceGuard([chosen[1]], sig), "confirm"); // ligne retirée
  assert.equal(G.replaceGuard(chosen, ""), "confirm"); // lignes ajoutées sans aucun choix préalable
  assert.equal(G.replaceGuard(chosen, undefined), "confirm");
});

test("noms de cotation uniques, insensibles à la casse et aux trous de numérotation", () => {
  assert.equal(G.uniqueName("Application métier", []), "Application métier");
  assert.equal(G.uniqueName("Application métier", ["application MÉTIER"].map((s) => s.toLowerCase())), "Application métier (2)");
  assert.equal(G.uniqueName("Site", ["Site", "Site (2)", "Site (3)"]), "Site (4)");
  assert.equal(G.uniqueName("Site", ["Site", "Site (3)"]), "Site (2)");
  assert.equal(G.uniqueName("  ", []), "Projet");
});

test("écarts de prix : au centime, sans bruit flottant ni offre apparue / disparue", () => {
  assert.deepEqual(G.priceDeltas(null, { vmi: 10 }), {});
  assert.deepEqual(G.priceDeltas({ vmi: 0.1, oi: 100 }, { vmi: 0.30000000000000004, oi: 100 }), { vmi: 0.2 });
  assert.deepEqual(G.priceDeltas({ vmi: 100 }, { vmi: 100.004 }), {}); // sous le centime : pas d'écart
  assert.deepEqual(G.priceDeltas({ vmi: 100 }, { vmi: 85, oi: 900 }), { vmi: -15 }); // oi vient d'apparaître
  assert.deepEqual(G.priceDeltas({ vmi: 100, oi: 900 }, { vmi: 100 }), {}); // oi a disparu
});

test("prix par offre : seules les offres chiffrables complètes comptent", () => {
  const results = [
    { ok: true, offer: { id: "vmi" }, monthly: 120, missing: [] },
    { ok: true, offer: { id: "oi" }, monthly: 900, missing: ["csp:tenant:v1"] },
    { ok: false, offer: { id: "vmw" }, reason: "too_big" },
  ];
  assert.deepEqual(G.monthlyByOffer(results), { vmi: 120 });
});
