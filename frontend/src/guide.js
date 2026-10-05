/* Parcours guidé : règles de l'assistant « Estimer mon projet ».
   - Première visite : un assistant plein écran (choix guidé / libre, 3 étapes,
     révélation) apprend le lien saisie → prix. Ensuite, on arrive directement
     dans l'app, dans le dernier mode utilisé ; l'assistant se relance à la demande.
   - « Choisir cette offre » remplit le devis ouvert s'il est vide, sinon crée
     une nouvelle cotation : un choix = un devis.
   - Chaque modification affiche l'écart de prix par offre.
   Module pur (aucun DOM), testé par frontend/tests/guide.test.js. */
(function exposeGuide(root) {
  const ONBOARDED_KEY = "calc.onboarded";
  const MODE_KEY = "calc.mode";
  const MODES = ["guided", "free"];
  const ENTRY = 0; // choix guidé / libre
  const LAST_STEP = 3; // étapes 1 à 3 : projet, serveurs, exigences
  const REVEAL = 4; // transition de révélation, jouée une seule fois

  // Préférences mémorisées dans le navigateur. Un stockage indisponible
  // (navigation privée, quota) équivaut à une première visite en mode guidé.
  function readPrefs(storage) {
    try {
      const mode = storage.getItem(MODE_KEY);
      return {
        onboarded: storage.getItem(ONBOARDED_KEY) === "1",
        mode: MODES.includes(mode) ? mode : "guided",
      };
    } catch {
      return { onboarded: false, mode: "guided" };
    }
  }

  function savePrefs(storage, prefs) {
    try {
      if (prefs.onboarded) storage.setItem(ONBOARDED_KEY, "1");
      if (MODES.includes(prefs.mode)) storage.setItem(MODE_KEY, prefs.mode);
    } catch {
      /* stockage indisponible : l'assistant réapparaîtra, sans gravité */
    }
  }

  // État de l'assistant. revealed : la révélation a déjà été jouée (une fois suffit).
  function initialGuide(prefs) {
    return { open: !prefs.onboarded, step: ENTRY, fromResult: false, revealed: !!prefs.onboarded };
  }

  // Transitions de l'assistant. Une action inconnue ou hors contexte laisse
  // l'état inchangé (même objet), pour que l'appelant puisse ignorer le rendu.
  function reduceGuide(g, action) {
    const revealing = g.open && g.step === REVEAL;
    // Quitter pendant la révélation la compte comme vue : elle ne sera pas rejouée.
    const close = { ...g, open: false, fromResult: false, revealed: g.revealed || revealing };
    switch (action.type) {
      case "open": {
        if (revealing) return g; // la révélation se termine d'abord
        // Depuis l'écran de résultat : reprise à l'étape demandée (pastille).
        const step = Math.min(Math.max(Number(action.step) || 1, 1), LAST_STEP);
        return { ...g, open: true, step, fromResult: !!action.fromResult };
      }
      case "pickGuided":
        return g.open && g.step === ENTRY ? { ...g, step: 1 } : g;
      case "pickFree":
      case "skip":
        return g.open ? close : g;
      case "next":
        if (!g.open || g.step === ENTRY || g.step === REVEAL) return g;
        // Modification depuis le résultat : on y retourne directement.
        if (g.fromResult) return close;
        if (g.step < LAST_STEP) return { ...g, step: g.step + 1 };
        return g.revealed ? close : { ...g, step: REVEAL };
      case "back":
        if (!g.open || g.step === ENTRY || g.step === REVEAL) return g;
        if (g.step > 1) return { ...g, step: g.step - 1 };
        return g.fromResult || g.revealed ? close : { ...g, step: ENTRY };
      case "goto": {
        // Seules les étapes déjà franchies sont cliquables dans la barre d'étapes.
        const n = Number(action.step);
        return g.open && n >= 1 && n < g.step && g.step <= LAST_STEP ? { ...g, step: n } : g;
      }
      case "revealDone":
        return g.step === REVEAL ? { ...close, revealed: true } : g;
      default:
        return g;
    }
  }

  // Un choix = un devis : on réutilise la cotation ouverte seulement si elle est vide.
  function chooseTarget(quote) {
    return quote && Array.isArray(quote.cart) && quote.cart.length === 0 ? "reuse" : "new";
  }

  // Nom de cotation unique : « Application métier », puis « Application métier (2) »…
  function uniqueName(base, existing) {
    const taken = new Set(existing.map((n) => String(n).trim().toLowerCase()));
    const clean = String(base || "Projet").trim() || "Projet";
    if (!taken.has(clean.toLowerCase())) return clean;
    let i = 2;
    while (taken.has(`${clean} (${i})`.toLowerCase())) i += 1;
    return `${clean} (${i})`;
  }

  // Prix mensuel par offre chiffrable (les offres non chiffrables sont absentes).
  function monthlyByOffer(results) {
    const out = {};
    results.forEach((r) => {
      if (r && r.ok && !(r.missing && r.missing.length)) out[r.offer.id] = r.monthly;
    });
    return out;
  }

  // Écart de prix par offre entre deux calculs, au centime près. Une offre qui
  // apparaît, disparaît ou ne bouge pas n'a pas d'écart : rien à signaler.
  function priceDeltas(previous, current) {
    const out = {};
    if (!previous) return out;
    Object.keys(current).forEach((id) => {
      if (!(id in previous)) return;
      const d = Math.round((current[id] - previous[id]) * 100) / 100;
      if (d !== 0) out[id] = d;
    });
    return out;
  }

  const api = {
    ONBOARDED_KEY,
    MODE_KEY,
    ENTRY,
    LAST_STEP,
    REVEAL,
    readPrefs,
    savePrefs,
    initialGuide,
    reduceGuide,
    chooseTarget,
    uniqueName,
    monthlyByOffer,
    priceDeltas,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalculatorGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
