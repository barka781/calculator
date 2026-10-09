/* Cloud Temple Calculator — calculette à plat.
   Familles dépliables, panier + résumé financier temps réel via /api/quote.
   Catalogue en prix publics ; remise « partenaire » (catalogue) seulement en mode partenaire. */

const LOCAL_FALLBACK = "http://127.0.0.1:8001";
// URL de l'API : window > localStorage > backend local. Mutable : voir le repli
// automatique dans fetchJson (une URL mémorisée invalide ne bloque plus le front).
let apiBase =
  window.CALCULATOR_API_BASE ||
  localStorage.getItem("calculatorApiBase") ||
  LOCAL_FALLBACK;

const PAGE_SIZE = 50;
const PERIODS = [1, 12, 24, 36, 48, 60];
const APP_VERSION_URL = "./Version";

/* ---------- Repli « plus jamais d'écran vide » ----------
   Deux filets sous l'API live :
   - CACHE_KEY : cache navigateur (health + catalogue) réécrit à chaque réponse
     live réussie → au prochain démarrage hors-ligne, on resert ces données fraîches.
     Volontairement SANS les 8806 licences (quota localStorage ~5 Mo).
   - SNAPSHOT_URL : snapshot embarqué livré avec l'image (catalogue + licences
     complètes), dernier recours au tout premier chargement à froid sans API. */
const CACHE_KEY = "calc.dataCache";
const SNAPSHOT_URL = "./src/snapshot.json";
let embeddedSnapshot = null; // snapshot embarqué chargé à la demande (mémoïsé)
const { CACHE_VERSION, chooseOfflineData } = window.CalculatorOfflineData;
const { calculateLocalQuote } = window.CalculatorQuoteCore;

/* ---------- Panneau financier redimensionnable ----------
   Largeur de la colonne résumé pilotée par la variable CSS --summary-w, bornée
   côté CSS par clamp(360px … 820px). Réglable via la poignée de glissement et
   les presets S/M/L, et mémorisée d'une session à l'autre. */
const SUMMARY_WIDTH_KEY = "calc.summaryWidth";
const SUMMARY_MIN = 360;
const SUMMARY_MAX = 820;
const SUMMARY_DEFAULT = 420; // compact par défaut : laisse la place aux propositions comparées
const SUMMARY_PRESETS = [
  { px: 420, label: "S", title: "Compact" },
  { px: 600, label: "M", title: "Standard" },
  { px: 820, label: "L", title: "Large" },
];

/* ---------- Familles & groupes (mappés sur le champ `category` du backend) ---------- */
const GROUPS = [
  { id: "start", label: "Démarrer" },
  { id: "infra", label: "Infrastructure — IaaS" },
  { id: "platform", label: "Plateforme — PaaS & IA" },
  { id: "data", label: "Données & continuité" },
  { id: "security", label: "Sécurité" },
  { id: "services", label: "Services & infogérance" },
  { id: "licenses", label: "Licences éditeurs" },
];

const FAMILIES = [
  { id: "estimate", label: "Estimer mon projet", group: "start", icon: "bulb", kind: "estimate", tag: "Décrivez votre besoin, on compare les offres" },
  { id: "compute", label: "Compute", group: "infra", icon: "compute", categories: ["Compute"], tag: "VM Instances, VMware, OpenIaaS, bare metal" },
  { id: "storage", label: "Stockage", group: "infra", icon: "storage", categories: ["Storage"], tag: "Bloc, fichier et objet S3" },
  { id: "network", label: "Réseau", group: "infra", icon: "network", categories: ["Network"], tag: "VPC, load balancer, connectivité" },
  { id: "housing", label: "Hébergement", group: "infra", icon: "housing", categories: ["Housing"], tag: "Housing et hébergement physique" },
  { id: "socle", label: "Socle", group: "infra", icon: "socle", categories: ["Socle"], tag: "Socle d'infrastructure managé" },
  { id: "paas", label: "PaaS", group: "platform", icon: "paas", categories: ["Paas"], tag: "Kubernetes, OpenShift, managé" },
  { id: "ia", label: "IA / LLMaaS", group: "platform", icon: "ia", categories: ["Llmaas"], tag: "LLM as a Service, inférence IA" },
  { id: "backup", label: "Sauvegarde", group: "data", icon: "backup", categories: ["Backup"], tag: "Backup et rétention" },
  { id: "pra", label: "PRA", group: "data", icon: "pra", categories: ["Pra"], tag: "Plan de reprise d'activité" },
  { id: "securityfam", label: "Sécurité", group: "security", icon: "security", categories: ["Security"], tag: "Firewall, bastion, sécurité réseau" },
  { id: "servicesfam", label: "Services & infogérance", group: "services", icon: "services", categories: ["Services"], tag: "Infogérance, support, prestations" },
  { id: "licenses", label: "Licences", group: "licenses", icon: "licenses", kind: "licenses", tag: "Microsoft, VMware et autres éditeurs" },
];

const categoryToFamily = (() => {
  const map = new Map();
  FAMILIES.forEach((f) => (f.categories || []).forEach((c) => map.set(c.toLowerCase(), f.id)));
  return map;
})();

/* ---------- Icônes ---------- */
const I = {
  brand:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .9-8.9 6 6 0 0 0-11.6-1.2A4 4 0 0 0 6 19z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  cart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.6 13.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L23 7H6"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  expand:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>',
  history:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>',
  save:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.6 15a1.6 1.6 0 0 0-1.1-1.5H1.4a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3 8.6a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 8 4.4h.1A1.6 1.6 0 0 0 9.6 3V2.4a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 4.4a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1.1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  compute:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  storage:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  network:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/></svg>',
  housing:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h8M8 14h8M10 18h4"/></svg>',
  socle:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/></svg>',
  paas:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5"/></svg>',
  ia:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/></svg>',
  backup:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4"/></svg>',
  pra:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  security:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9a2 2 0 0 1 4 0v2"/></svg>',
  services:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  licenses:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H4z"/><path d="M4 20h16M9 16v4M15 16v4"/></svg>',
  panelHide:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M8 10l2 2-2 2"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  bulb:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
};
const familyIcon = (f) => I[f.icon] || I.services;

/* ---------- État ---------- */
const quoteBoot = loadQuoteState();

// Mode partenaire (remise catalogue) : piloté par le DÉPLOIEMENT via
// /health.view_partner (config .env CALCULATOR_VIEW_PARTNER). Plus de bascule UI ni de
// localStorage ; côté serveur, quote.py neutralise toute remise hors mode partenaire.

// Préférences d'affichage du résumé : replis des sections « Configuration » et
// « Détail financier » (mémorisés). La modale « panier en grand » n'est pas persistée.
const SUMMARY_UI_KEY = "calc.summaryUi";
function loadSummaryUi() {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY_UI_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function persistSummaryUi() {
  try {
    localStorage.setItem(
      SUMMARY_UI_KEY,
      JSON.stringify({ cfg: state.cfgCollapsed, totals: state.totalsCollapsed, hidden: state.summaryHidden })
    );
  } catch {
    /* stockage indisponible : non bloquant */
  }
}
const _summaryUi = loadSummaryUi();

// Historique des devis : snapshots locaux (localStorage), réouvrables. Plafonné.
const HISTORY_KEY = "calc.history";
const HISTORY_MAX = 50;

const state = {
  partner: false, // défini depuis /health.view_partner au chargement (config .env)
  health: null,
  online: false,
  apiError: "",
  loading: true,
  dataSource: "live", // "live" | "cache" | "embedded"
  dataStale: false, // true quand on sert un repli (API injoignable)
  dataSavedAt: "", // horodatage de la donnée de repli affichée
  appVersion: "",
  catalog: [],
  catalogByFamily: new Map(),
  search: "",
  activeFamily: "estimate", // vue de la colonne centrale : estimation guidée ou famille du catalogue
  subfamily: "", // sous-famille active (sub_type) ; "" = toutes
  openCards: new Set(), // SKU des cartes produit dépliées (détail specs)
  openLines: new Set(), // clés des lignes de devis dépliées (détail term-aware)
  lic: { all: [], loaded: false, loading: false, error: "", query: "", vendor: "", term: "", page: 1 },
  quotes: quoteBoot.quotes,
  activeQuoteId: quoteBoot.activeQuoteId,
  // Affichage du résumé
  cfgCollapsed: _summaryUi.cfg === true, // bloc « nom + projection » replié
  totalsCollapsed: _summaryUi.totals === true, // détail financier replié
  summaryMax: false, // panier ouvert en grand (modale)
  summaryHidden: _summaryUi.hidden === true, // panier masqué (pastille pour le rouvrir)
};

const app = document.querySelector("#app");
let quoteTimer = null;
let quoteReq = 0;
let searchTimer = null;
let licTimer = null;

Object.defineProperties(state, {
  cart: {
    get: () => activeQuote().cart,
    set: (v) => {
      activeQuote().cart = sanitizeCart(v);
    },
  },
  period: {
    get: () => activeQuote().period,
    set: (v) => {
      activeQuote().period = PERIODS.includes(Number(v)) ? Number(v) : 12;
    },
  },
  discount: {
    get: () => activeQuote().discount,
    set: (v) => {
      activeQuote().discount = clamp(Number(v), 0, 100);
    },
  },
  projectName: {
    get: () => activeQuote().projectName,
    set: (v) => {
      activeQuote().projectName = String(v || "");
    },
  },
  quote: {
    get: () => activeQuote().quote,
    set: (v) => {
      activeQuote().quote = v;
    },
  },
  quoteLoading: {
    get: () => activeQuote().quoteLoading,
    set: (v) => {
      activeQuote().quoteLoading = !!v;
    },
  },
  quoteError: {
    get: () => activeQuote().quoteError,
    set: (v) => {
      activeQuote().quoteError = String(v || "");
    },
  },
  quoteSource: {
    get: () => activeQuote().quoteSource,
    set: (v) => {
      activeQuote().quoteSource = v === "local" ? "local" : "live";
    },
  },
});
persistQuotes();

/* ---------- Helpers ---------- */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

// Échappe le texte puis entoure les termes recherchés de <mark> pour les surligner.
function highlight(text, q) {
  const safe = esc(text);
  const tokens = [...new Set(String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean))].map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  if (!tokens.length) return safe;
  try {
    return safe.replace(new RegExp(`(${tokens.join("|")})`, "gi"), "<mark>$1</mark>");
  } catch {
    return safe;
  }
}

const money = (v, compact = false) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: compact ? 0 : 2,
  }).format(Number(v) || 0);

const num = (v) => new Intl.NumberFormat("fr-FR").format(Number(v) || 0);

// Date ISO → libellé court fr ; tolère valeur vide ou invalide sans casser le rendu.
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
};

const clone = (v) => JSON.parse(JSON.stringify(v));

function buildUrl(path, params = {}, base = apiBase) {
  const root = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(path, root);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

async function fetchOnce(base, path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 12000);
  try {
    const res = await fetch(buildUrl(path, options.params, base), {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchJson(path, options = {}) {
  try {
    return await fetchOnce(apiBase, path, options);
  } catch (err) {
    // Repli automatique : une URL configurée (window/localStorage) injoignable ou
    // malformée ne doit pas bloquer le front. On tente une fois le backend local ;
    // si ça répond, on bascule pour le reste de la session (sans toucher localStorage).
    if (apiBase !== LOCAL_FALLBACK) {
      try {
        const data = await fetchOnce(LOCAL_FALLBACK, path, options);
        console.warn(`[calculator] API « ${apiBase} » injoignable → repli automatique sur ${LOCAL_FALLBACK}`);
        apiBase = LOCAL_FALLBACK;
        return data;
      } catch {
        // Le repli local a aussi échoué : on propage l'erreur d'origine.
      }
    }
    throw err;
  }
}

function quoteId() {
  return window.crypto?.randomUUID?.() || `quote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCart(lines) {
  return Array.isArray(lines)
    ? lines
        .filter((l) => l && l.sku)
        .map((l) => ({
          sku: String(l.sku),
          source: l.source === "license" ? "license" : "catalog",
          name: String(l.name || l.sku),
          unit: String(l.unit || "unité"),
          minQty: Math.max(1, Math.round(Number(l.minQty) || 1)),
          quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
        }))
    : [];
}

function createQuote(data = {}, index = 0) {
  return {
    id: data.id || quoteId(),
    name: String(data.name || `Cotation ${index + 1}`),
    projectName: String(data.projectName || ""),
    cart: sanitizeCart(data.cart),
    period: PERIODS.includes(Number(data.period)) ? Number(data.period) : 12,
    discount: clamp(Number(data.discount) || 0, 0, 100),
    quote: data.quote || null,
    quoteLoading: false,
    quoteError: "",
    quoteSource: data.quoteSource === "local" ? "local" : "live",
    // Une cotation = un projet du client : elle porte sa propre estimation guidée.
    est: data.est && typeof data.est === "object" ? data.est : null,
    // Empreinte du panier juste après le dernier « Choisir cette offre » (garde de remplacement).
    chosenSig: typeof data.chosenSig === "string" ? data.chosenSig : "",
  };
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("calc.cart") || "[]");
    return sanitizeCart(raw);
  } catch {
    return [];
  }
}

function loadQuoteState() {
  try {
    const stored = JSON.parse(localStorage.getItem("calc.quotes") || "null");
    const source = Array.isArray(stored) ? { quotes: stored, activeQuoteId: stored[0]?.id } : stored;
    if (source && Array.isArray(source.quotes) && source.quotes.length) {
      const quotes = source.quotes.map((q, i) => createQuote(q, i));
      const activeQuoteId = quotes.some((q) => q.id === source.activeQuoteId) ? source.activeQuoteId : quotes[0].id;
      return { quotes, activeQuoteId };
    }
  } catch {
    // Migration douce : si le nouveau format est illisible, on retombe sur les anciennes clés.
  }

  const migrated = createQuote(
    {
      name: "Cotation 1",
      projectName: localStorage.getItem("calc.project") || "",
      cart: loadCart(),
      period: Number(localStorage.getItem("calc.period")) || 12,
      discount: Number(localStorage.getItem("calc.discount")) || 0,
    },
    0
  );
  return { quotes: [migrated], activeQuoteId: migrated.id };
}

function persistQuotes() {
  localStorage.setItem(
    "calc.quotes",
    JSON.stringify({
      activeQuoteId: state.activeQuoteId,
      quotes: state.quotes.map((q) => ({
        id: q.id,
        name: q.name,
        projectName: q.projectName,
        cart: q.cart,
        period: q.period,
        discount: q.discount,
        est: q.est,
        chosenSig: q.chosenSig,
      })),
    })
  );
}

function persistCart() {
  persistQuotes();
}

function activeQuote() {
  const found = state.quotes.find((q) => q.id === state.activeQuoteId);
  if (found) return found;
  state.activeQuoteId = state.quotes[0]?.id || "";
  return state.quotes[0] || createQuote({}, 0);
}

function quoteLabel(q, index = 0) {
  return q.projectName.trim() || q.name || `Cotation ${index + 1}`;
}

function setActiveQuote(id) {
  if (!state.quotes.some((q) => q.id === id)) return;
  state.activeQuoteId = id;
  quoteReq += 1;
  window.clearTimeout(quoteTimer);
  resetEstimateUi();
  persistQuotes();
  render();
  if (state.cart.length && !state.quote) scheduleQuote();
}

function addQuote() {
  const q = createQuote({ name: `Cotation ${state.quotes.length + 1}` }, state.quotes.length);
  state.quotes.push(q);
  setActiveQuote(q.id);
}

function duplicateQuote() {
  const source = activeQuote();
  const sourceIndex = state.quotes.findIndex((q) => q.id === source.id);
  const label = quoteLabel(source, sourceIndex);
  const q = createQuote(
    {
      name: `${label} copie`,
      projectName: `${label} copie`,
      cart: clone(source.cart),
      period: source.period,
      discount: source.discount,
      est: source.est ? clone(source.est) : null,
      chosenSig: source.chosenSig,
    },
    state.quotes.length
  );
  state.quotes.push(q);
  setActiveQuote(q.id);
}

function closeQuote(id) {
  if (state.quotes.length <= 1) return;
  const idx = state.quotes.findIndex((q) => q.id === id);
  if (idx < 0) return;
  state.quotes.splice(idx, 1);
  if (state.activeQuoteId === id) {
    const next = state.quotes[Math.min(idx, state.quotes.length - 1)];
    state.activeQuoteId = next.id;
    quoteReq += 1;
  }
  persistQuotes();
  render();
  if (state.cart.length && !state.quote) scheduleQuote();
}

const engagementMonths = (str) => {
  const m = /(\d+)\s*mois/i.exec(String(str || ""));
  return m ? Number(m[1]) : 1;
};

const termLabel = (t) => {
  const map = { monthly: "Mensuel", yearly: "Annuel", annual: "Annuel", multiyear: "Pluriannuel", one_shot: "Ponctuel", oneshot: "Ponctuel" };
  return map[String(t || "").toLowerCase()] || (t ? String(t) : "");
};

// Suffixe de terme pour un prix natif récurrent (« / an », « / 3 ans », « / mois »).
function lineTermSuffix(ql) {
  if (!ql || ql.recurring === false) return "";
  const t = String(ql.term || "").toLowerCase();
  if (t === "annual") return " / an";
  if (t === "multiyear") return ` / ${Math.max(1, Math.round((ql.term_months || 12) / 12))} ans`;
  return " / mois";
}

// Mot de terme pour le détail de ligne (annuel, pluriannuel, perpétuel, mensuel…).
function lineTermWord(ql) {
  if (!ql) return "";
  if (ql.recurring === false) return "perpétuel";
  const t = String(ql.term || "").toLowerCase();
  if (t === "annual") return "annuel";
  if (t === "multiyear") return `${Math.max(1, Math.round((ql.term_months || 12) / 12))} ans`;
  if (ql.source === "catalog" && ql.engagement_months > 1) return `engagement ${ql.engagement_months} mois`;
  return "mensuel";
}

/* ---------- Données ---------- */

async function loadAppVersion() {
  try {
    const res = await fetch(APP_VERSION_URL, { cache: "no-store", headers: { accept: "text/plain" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.appVersion = (await res.text()).trim();
  } catch {
    state.appVersion = "";
  }
  renderVersion();
}

// Mémorise les données live fraîches (health + catalogue) pour le prochain
// démarrage hors-ligne. Volontairement SANS les licences (trop volumineuses pour
// le quota localStorage) : celles-ci viennent du snapshot embarqué en repli.
function cacheLiveData(health, catalogResponse) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        version: CACHE_VERSION,
        health,
        catalog: { items: catalogResponse.items || [] },
      })
    );
  } catch {
    // Quota dépassé ou stockage indisponible : non bloquant, le snapshot embarqué prend le relais.
  }
}

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (window.CalculatorOfflineData.isValidCachePayload(data)) return data;
  } catch {
    /* cache illisible : ignoré */
  }
  return null;
}

// Charge (une seule fois) le snapshot embarqué livré avec l'image.
async function loadEmbeddedSnapshot() {
  if (embeddedSnapshot) return embeddedSnapshot;
  try {
    const res = await fetch(SNAPSHOT_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    embeddedSnapshot = await res.json();
  } catch {
    embeddedSnapshot = null;
  }
  return embeddedSnapshot;
}

// API injoignable : sert les meilleures données disponibles, sans jamais laisser
// d'écran vide. Priorité au cache navigateur (vu en ligne récemment, donc le plus
// frais pour cet utilisateur) ; à défaut, le snapshot embarqué (complet mais figé
// à la date du build). Renvoie true si des données ont pu être affichées.
async function applyOfflineFallback() {
  const cache = readCache();
  const choice = chooseOfflineData(cache, cache ? null : await loadEmbeddedSnapshot());
  if (!choice) {
    state.dataStale = false;
    return false;
  }

  state.health = choice.data.health || null;
  state.partner = !!state.health?.view_partner; // repli : reprend la config de la dernière santé connue
  state.catalog = ((choice.data.catalog?.items) || []).map(normalizeCatalog);
  groupCatalog();
  state.dataSource = choice.source;
  state.dataStale = true;
  state.dataSavedAt = choice.savedAt;
  state.apiError = "";
  return true;
}

async function loadAll() {
  state.loading = true;
  state.apiError = "";

  let catalogOk = false;
  try {
    state.health = await fetchJson("health", { timeout: 6000 });
    state.online = state.health?.status === "ok";
    state.partner = !!state.health?.view_partner; // mode partenaire piloté par le déploiement
  } catch {
    state.online = false;
    state.apiError = "API injoignable";
  }

  if (state.online) {
    try {
      const data = await fetchJson("api/catalog", { params: { limit: 1000, include_deprecated: false } });
      state.catalog = (data.items || []).map(normalizeCatalog);
      groupCatalog();
      catalogOk = true;
      state.dataSource = "live";
      state.dataStale = false;
      state.dataSavedAt = "";
      cacheLiveData(state.health, data); // données fraîches → cache navigateur
    } catch {
      state.apiError = "Catalogue indisponible";
    }
  }

  // Filet anti « écran vide » : si le catalogue live a échoué (API injoignable ou
  // en erreur), on bascule sur le cache navigateur puis le snapshot embarqué.
  if (!catalogOk) {
    const fallbackOk = await applyOfflineFallback();
    if (!fallbackOk) {
      state.dataStale = false;
      state.dataSavedAt = "";
    }
  }

  state.loading = false;
  render();
  if (state.cart.length) scheduleQuote();
}

function normalizeCatalog(item) {
  const ps = item.pricing_summary || {};
  const specs = item.specs || {};
  const meta = item.metadata || {};
  const familyId = categoryToFamily.get(String(item.category || "").toLowerCase()) || "servicesfam";
  const publicPrice = Number(ps.public_price ?? item.pricing?.public_price ?? 0);
  const pct = Number(ps.discount_percent ?? 0);
  return {
    sku: item.sku,
    source: "catalog",
    name: item.name || item.title || item.sku,
    description: item.description || "",
    category: item.category || "",
    type: item.type || "",
    subType: item.sub_type || "",
    familyId,
    unit: ps.unit || item.unit || "unité",
    publicPrice,
    discountPct: pct,
    discountedPrice: Number(ps.discounted_price ?? publicPrice),
    engagement: ps.engagement || item.pricing?.engagement || "",
    baseQty: Number(ps.base_quantity || item.base_quantity || 1) || 1,
    minQty: Number(ps.min_quantity || 1) || 1,
    // Qualification SecNumCloud : acquise (true) ou en cours (« EN COURS » au
    // catalogue). Ne jamais présenter une qualification en cours comme acquise.
    snc: sncStatus(meta.snc),
    specs, // specs brutes conservées pour les puces/table en lecture seule (Lot 2)
    tags: tagsFor(item, specs),
  };
}

// Statut SecNumCloud tolérant aux variantes d'écriture du catalogue : acquis
// (true, "oui", "yes", "qualifié"…), en cours (« EN COURS », "pending"…) ou inconnu.
function sncStatus(raw) {
  if (raw === true) return "yes";
  const v = String(raw ?? "").trim().toLowerCase();
  if (/cours|pending/.test(v)) return "pending";
  if (["true", "yes", "oui", "qualifie", "qualifié"].includes(v)) return "yes";
  return "";
}

function tagsFor(item, specs) {
  const out = [];
  // Type : rendu visible pour expliquer un match (ex. « baremetal » est dans le type, pas le nom).
  const typeLabel = prettify(item.type);
  if (typeLabel && typeLabel.toLowerCase() !== String(item.category || "").toLowerCase()) out.push(typeLabel);
  if (item.sub_type && item.sub_type !== item.type) out.push(prettify(item.sub_type));
  if (specs.cores) out.push(`${specs.cores} cores`);
  if (specs.ram) out.push(`${specs.ram} Go RAM`);
  if (specs.vcpu) out.push(`${specs.vcpu} vCPU`);
  if (specs.iops_per_tb) out.push(`${specs.iops_per_tb} IOPS/To`);
  return out.slice(0, 4);
}
const prettify = (s) => String(s || "").replaceAll("_", " ");

/* ---------- Specs produit (lecture seule, génériques par famille) ----------
   Le catalogue est en SKU figés : on affiche les specs telles quelles, sans
   dimensionnement continu. Couverture hétérogène selon la famille (riche sur
   Compute, absente sur Réseau/LLMaaS) → formatage tolérant + repli générique. */
const frDec = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Number(v) || 0);

function fmtSpecValue(v) {
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (Array.isArray(v)) return esc(v.map((x) => prettify(String(x))).join(", "));
  if (typeof v === "number") return num(v);
  return esc(prettify(String(v ?? "")));
}

// label : libellé en table ; chip(v) : rendu compact (puce) quand pertinent ; val(v) : valeur en table.
const SPEC_META = {
  cores: { label: "Cœurs", chip: (v) => `<b>${num(v)}</b> cœurs`, val: (v) => num(v) },
  threads: { label: "Threads", val: (v) => num(v) },
  vcpu: { label: "vCPU", chip: (v) => `<b>${num(v)}</b> vCPU`, val: (v) => num(v) },
  ram: { label: "Mémoire vive", chip: (v) => `<b>${num(v)}</b> Go RAM`, val: (v) => `${num(v)} Go` },
  cpu_model: { label: "Processeur", chip: (v) => esc(String(v)), val: (v) => esc(String(v)) },
  cpu_base_freq: { label: "Fréquence de base", chip: (v) => `${frDec(v)} GHz`, val: (v) => `${frDec(v)} GHz` },
  cpu_turbo_freq: { label: "Fréquence turbo", val: (v) => `${frDec(v)} GHz` },
  gpu: { label: "GPU", chip: (v) => `${fmtSpecValue(v)} · GPU`, val: fmtSpecValue },
  nodes: { label: "Nœuds", chip: (v) => `<b>${num(v)}</b> nœuds`, val: (v) => num(v) },
  cores_per_node: { label: "Cœurs / nœud", chip: (v) => `${num(v)} c/nœud`, val: (v) => num(v) },
  threads_per_node: { label: "Threads / nœud", val: (v) => num(v) },
  ram_per_node: { label: "RAM / nœud", chip: (v) => `${num(v)} Go/nœud`, val: (v) => `${num(v)} Go` },
  storage_per_node: { label: "Stockage / nœud", val: (v) => `${num(v)} Go` },
  storage_type: { label: "Type de stockage", chip: (v) => esc(prettify(String(v))), val: (v) => esc(prettify(String(v))) },
  iops_per_tb: { label: "IOPS / To", chip: (v) => `${num(v)} IOPS/To`, val: (v) => `${num(v)} IOPS/To` },
  redundancy_zones: { label: "Zones de redondance", val: (v) => num(v) },
  replication: { label: "Réplication", val: fmtSpecValue },
  replication_type: { label: "Type de réplication", val: fmtSpecValue },
  technology: { label: "Technologie", chip: (v) => esc(String(v)), val: (v) => esc(String(v)) },
  retention: { label: "Rétention", chip: (v) => esc(String(v)), val: (v) => esc(String(v)) },
  level: { label: "Niveau", val: fmtSpecValue },
  type: { label: "Type", val: fmtSpecValue },
  power: { label: "Puissance", val: fmtSpecValue },
  power_feeds: { label: "Arrivées électriques", val: fmtSpecValue },
  speed: { label: "Débit", val: fmtSpecValue },
  height: { label: "Hauteur", val: fmtSpecValue },
  max_ips: { label: "IP max", val: (v) => num(v) },
  protocols: { label: "Protocoles", val: fmtSpecValue },
  recording: { label: "Enregistrement", val: fmtSpecValue },
  features: { label: "Fonctions", val: fmtSpecValue },
};

const SPEC_ORDER = [
  "cores", "vcpu", "threads", "ram", "cpu_model", "cpu_base_freq", "cpu_turbo_freq", "gpu",
  "nodes", "cores_per_node", "threads_per_node", "ram_per_node", "storage_per_node",
  "storage_type", "iops_per_tb", "redundancy_zones", "replication", "replication_type",
  "technology", "retention", "level", "type", "power", "power_feeds", "speed", "height",
];

// Entrées specs ordonnées (clés connues d'abord, le reste à la suite).
function specEntries(p) {
  const specs = p.specs || {};
  const keys = Object.keys(specs).filter((k) => {
    const v = specs[k];
    return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
  });
  keys.sort((a, b) => {
    const ia = SPEC_ORDER.indexOf(a);
    const ib = SPEC_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return keys.map((k) => {
    const meta = SPEC_META[k] || { label: prettify(k), val: fmtSpecValue };
    return { key: k, label: meta.label, chip: meta.chip, val: (meta.val || fmtSpecValue)(specs[k]) };
  });
}

// Puces compactes : au plus 4 specs disposant d'un rendu « chip ».
function specChipsHtml(p) {
  const chips = specEntries(p).filter((e) => e.chip).slice(0, 4);
  return chips.map((e) => `<span class="spec-chip">${e.chip(p.specs[e.key])}</span>`).join("");
}

// Table détaillée (carte dépliée) : toutes les specs + ligne facturation.
function specRowsHtml(p) {
  const rows = [`<div class="row"><span>Référence</span><span class="mono">${highlight(p.sku, state.search)}</span></div>`];
  rows.push(...specEntries(p).map((e) => `<div class="row"><span>${esc(e.label)}</span><span>${e.val}</span></div>`));
  if (p.engagement) rows.push(`<div class="row"><span>Facturation</span><span>${esc(p.engagement)}</span></div>`);
  return rows.join("");
}

function groupCatalog() {
  const map = new Map();
  FAMILIES.forEach((f) => map.set(f.id, []));
  state.catalog.forEach((p) => {
    if (!map.has(p.familyId)) map.set(p.familyId, []);
    map.get(p.familyId).push(p);
  });
  map.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, "fr")));
  state.catalogByFamily = map;
}

async function loadLicenses() {
  if (state.lic.loaded || state.lic.loading) return;
  state.lic.loading = true;
  state.lic.error = "";
  renderLicenseResults();

  // Hors-ligne : les licences viennent du snapshot embarqué (volontairement absentes
  // du cache navigateur, cf. quota). Évite un appel réseau voué à l'échec.
  if (!state.online) {
    const snapshot = await loadEmbeddedSnapshot();
    const items = snapshot?.licenses?.items || [];
    if (items.length) {
      state.lic.all = items.map(normalizeLicense);
      state.lic.loaded = true;
    } else {
      state.lic.error = "Licences indisponibles hors connexion";
    }
    state.lic.loading = false;
    renderLicenseResults();
    return;
  }

  try {
    // Le backend plafonne limit à 1000 : on pagine jusqu'à tout récupérer.
    const PAGE = 1000;
    let skip = 0;
    let total = Infinity;
    const all = [];
    while (skip < total) {
      const data = await fetchJson("api/licenses", { params: { limit: PAGE, skip }, timeout: 15000 });
      total = Number(data.total) || all.length;
      (data.items || []).forEach((it) => all.push(normalizeLicense(it)));
      if (!data.items || data.items.length < PAGE) break;
      skip += PAGE;
    }
    state.lic.all = all;
    state.lic.loaded = true;
  } catch {
    state.lic.error = "Chargement des licences impossible";
  } finally {
    state.lic.loading = false;
    renderLicenseResults();
  }
}

function normalizeLicense(item) {
  const pricing = item.pricing || {};
  const publicPrice = Number(item.price ?? pricing.public_price ?? 0);
  const pct = Number(pricing.discounts?.standard ?? 0);
  return {
    sku: item.sku,
    source: "license",
    name: item.name || item.sku,
    vendor: item.vendor || "—",
    edition: item.edition || "",
    unit: item.unit || "licence",
    term: pricing.term || "",
    engagement: pricing.engagement, // durée (années) pour le pluriannuel ; sert au miroir term-aware
    publicPrice,
    discountPct: pct,
    discountedPrice: publicPrice * (1 - pct / 100),
    search: `${item.sku} ${item.name} ${item.vendor} ${item.edition} ${item.description || ""}`.toLowerCase(),
  };
}

/* ---------- Panier ---------- */
const lineKey = (sku, source) => `${source}:${sku}`;
const findLine = (sku, source) => state.cart.find((l) => l.sku === sku && l.source === source);

// A4 (RGAA) : annonce un message court et ciblé aux lecteurs d'écran via la région
// live #sr-announce (role=status, aria-live=polite, hors #app donc persistante).
// On préfère des messages concis (« X ajouté », total net) plutôt que de rendre les
// grandes zones (#summary-lines, badge) « live » — ce qui serait verbeux/inutilisable.
function announce(message) {
  const region = document.querySelector("#sr-announce");
  if (region) region.textContent = message;
}

function upsertLine(meta, qty) {
  const q = clamp(Math.round(qty), meta.minQty || 1, 1e9);
  const existing = findLine(meta.sku, meta.source);
  if (existing) {
    existing.quantity = q;
  } else {
    state.cart.push({
      sku: meta.sku,
      source: meta.source,
      name: meta.name,
      unit: meta.unit,
      minQty: meta.minQty || 1,
      quantity: q,
    });
  }
  persistCart();
}

function bumpLine(sku, source, delta) {
  const line = findLine(sku, source);
  if (!line) return;
  const next = (line.quantity || 0) + delta;
  if (next < (line.minQty || 1)) {
    removeLine(sku, source);
    return;
  }
  line.quantity = next;
  persistCart();
}

function removeLine(sku, source) {
  const removed = findLine(sku, source); // [A4] nom capturé avant suppression
  state.cart = state.cart.filter((l) => !(l.sku === sku && l.source === source));
  persistCart();
  if (removed) announce(`${removed.name} retiré du devis`);
}

function clearCart() {
  state.cart = [];
  state.quote = null;
  state.quoteLoading = false;
  state.quoteError = "";
  state.quoteSource = "live";
  persistCart();
  announce("Devis vidé");
}

/* ---------- Devis temps réel ---------- */
function scheduleQuote() {
  window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(runQuote, 220);
}

async function localQuoteForCart() {
  let catalog = state.catalog;
  let licenses = state.lic.loaded ? state.lic.all : [];

  const needsSnapshotCatalog = state.cart.some((line) => line.source === "catalog" && !catalog.some((item) => item.sku === line.sku));
  const needsSnapshotLicenses = state.cart.some((line) => line.source === "license" && !licenses.some((item) => item.sku === line.sku));

  if (needsSnapshotCatalog || needsSnapshotLicenses) {
    const snapshot = await loadEmbeddedSnapshot();
    if (snapshot?.catalog?.items?.length && needsSnapshotCatalog) {
      catalog = snapshot.catalog.items.map(normalizeCatalog);
    }
    if (snapshot?.licenses?.items?.length && needsSnapshotLicenses) {
      licenses = snapshot.licenses.items.map(normalizeLicense);
      state.lic.all = licenses;
      state.lic.loaded = true;
      state.lic.error = "";
    }
  }

  return calculateLocalQuote({
    lines: state.cart,
    catalog,
    licenses,
    periodMonths: state.period,
    discountPercent: state.discount,
    partner: state.partner,
  });
}

async function runQuote() {
  if (!state.cart.length) {
    state.quote = null;
    state.quoteLoading = false;
    state.quoteError = "";
    state.quoteSource = "live";
    renderSummaryLines();
    renderSummaryTotals();
    return;
  }
  const reqId = ++quoteReq;
  state.quoteLoading = true;
  state.quoteError = "";
  renderSummaryTotals();
  try {
    const body = {
      lines: state.cart.map((l) => ({ sku: l.sku, quantity: l.quantity, source: l.source })),
      period_months: state.period,
      partner: state.partner,
      discount_percent: state.partner ? state.discount : 0,
    };
    const data = await fetchJson("api/quote", { method: "POST", body: JSON.stringify(body) });
    if (reqId !== quoteReq) return;
    state.quote = data;
    state.quoteSource = "live";
  } catch {
    if (reqId !== quoteReq) return;
    try {
      state.quote = await localQuoteForCart();
      state.quoteSource = "local";
      state.quoteError = "";
    } catch {
      state.quoteError = state.dataStale ? "Calcul indisponible hors-ligne" : "Calcul indisponible";
      state.quoteSource = "live";
    }
  } finally {
    if (reqId === quoteReq) {
      state.quoteLoading = false;
      renderSummaryLines();
      renderSummaryTotals();
      // [A4] Annonce concise du résultat du recalcul (débouncé par scheduleQuote).
      if (state.quoteError) announce(state.quoteError);
      else if (state.quote) announce(`Total mensuel net : ${money(state.quote.monthly_discounted_total)}`);
    }
  }
}

const quoteLineFor = (sku, source) =>
  state.quote?.lines?.find((l) => l.sku === sku && l.source === source);

/* ---------- Rendu : prix ---------- */
// Bloc prix d'une carte produit. Prix public par défaut ; le prix remisé
// (taux partenaire catalogue) n'apparaît qu'en mode partenaire.
function cardPriceHtml(p) {
  const hasDiscount = state.partner && p.discountPct > 0 && p.discountedPrice < p.publicPrice - 0.0001;
  const main = hasDiscount ? p.discountedPrice : p.publicPrice;
  return `
    ${hasDiscount ? `<div class="pc__price-public">${esc(money(p.publicPrice))}</div>` : ""}
    <div class="pc__price-main">${esc(money(main))} <span class="per">/ ${esc(p.unit)}</span></div>
    ${hasDiscount ? `<div class="pc__price-note">Partenaire −${num(p.discountPct)} %</div>` : ""}`;
}

// Étiquette de terme (mensuel / annuel / pluriannuel / perpétuel) pour une ligne de devis.
function termChipHtml(ql) {
  if (!ql) return "";
  let cls = "monthly";
  let label = "Mensuel";
  if (ql.recurring === false) {
    cls = "perpetual";
    label = "Perpétuel";
  } else {
    const t = String(ql.term || "").toLowerCase();
    if (t === "annual") {
      cls = "annual";
      label = "Annuel";
    } else if (t === "multiyear") {
      cls = "multiyear";
      label = `${Math.max(1, Math.round((ql.term_months || 12) / 12))} ans`;
    }
  }
  return `<span class="term-chip ${cls}">${esc(label)}</span>`;
}

/* ---------- Squelette ---------- */
function mount() {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand__mark">${I.brand}</div>
          <div class="brand__text">
            <span class="brand__eyebrow">Cloud Temple</span>
            <span class="brand__title">Calculateur d'offre Cloud</span>
          </div>
        </div>
        <div class="topbar__spacer"></div>
        <div class="topbar__tools">
          <!-- TEMPORAIRE (recette) : rejouer la première visite. À retirer avant la mise en ligne. -->
          <button class="btn btn--ghost btn--sm" type="button" data-guide-replay title="Temporaire : rejouer la première visite (accueil, 3 étapes, révélation)">Revoir l'accueil</button>
          <div class="segmented mode-switch" role="group" aria-label="Mode de devis">
            <button type="button" data-mode="guided" aria-pressed="false" title="Décrivez votre projet, nous comparons les offres">Guidé</button>
            <button type="button" data-mode="free" aria-pressed="false" title="Composez votre devis depuis le catalogue">Libre</button>
          </div>
          <button class="btn btn--ghost btn--sm" data-history-open title="Historique des devis enregistrés">${I.history} Historique</button>
          <button class="btn btn--ghost btn--icon" data-set-api title="Configurer l'URL de l'API">${I.gear}</button>
        </div>
      </header>

      <nav class="quote-tabs" id="quote-tabs" aria-label="Cotations"></nav>

      <div id="banner-slot"></div>

      <div class="layout">
        <aside class="sidebar" id="sidebar" aria-label="Catalogue"></aside>

        <main class="main">
          <div class="main__toolbar">
            <div class="search-box">
              ${I.search}
              <input id="q-global" class="input" placeholder="Rechercher un produit ou une licence (nom, SKU, type…)" value="${esc(state.search)}" />
            </div>
          </div>
          <div id="main-body"></div>
        </main>

        <aside id="summary-slot">${summarySkeleton()}</aside>
      </div>

      <div class="summary-backdrop" data-summary-close aria-hidden="true"></div>
      <button type="button" class="summary-pill" id="summary-pill" data-summary-show hidden></button>

      <div class="modal modal--confirm" id="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <div class="modal__backdrop" data-confirm="cancel"></div>
        <div class="modal__dialog">
          <div class="modal__head"><h2 id="confirm-title"></h2></div>
          <div class="modal__body">
            <p class="confirm__body" id="confirm-body"></p>
            <div class="confirm__actions">
              <button type="button" class="btn btn--ghost" data-confirm="cancel">Annuler</button>
              <button type="button" class="btn btn--danger" data-confirm="ok">Confirmer</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal" id="history-modal" role="dialog" aria-modal="true" aria-label="Historique des devis">
        <div class="modal__backdrop" data-history-close></div>
        <div class="modal__dialog">
          <div class="modal__head">
            <h2>Historique des devis</h2>
            <button class="modal__close" type="button" data-history-close aria-label="Fermer l'historique">${I.close}</button>
          </div>
          <div class="modal__body" id="history-list"></div>
        </div>
      </div>

    </div>
    <div id="guide" class="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" hidden></div>`;
  renderQuoteControls();
  wireEvents();
  wireResizer();
  wireSummaryScroll();
  wireSummaryModal();
  applySummaryWidth(readSummaryWidth(), false); // restaure la largeur mémorisée
  applySummaryHidden();
}

function quoteTabsHtml() {
  const tabs = state.quotes
    .map((q, i) => {
      const active = q.id === state.activeQuoteId;
      const label = quoteLabel(q, i);
      const lineCount = q.cart.length;
      // A1 (RGAA) : la croix de fermeture est un vrai <button> focusable, frère du
      // bouton de bascule — pas un <span> imbriqué (un <button> dans un <button> est
      // invalide et la croix n'était pas atteignable au clavier). Le conteneur porte
      // désormais l'aspect « pill » et l'état actif.
      return `
        <div class="quote-tab ${active ? "is-active" : ""}">
          <button type="button" class="quote-tab__main" data-quote-switch="${esc(q.id)}" title="${esc(label)}">
            <span class="quote-tab__label">${esc(label)}</span>
            <span class="quote-tab__count">${num(lineCount)}</span>
          </button>
          ${
            state.quotes.length > 1
              ? `<button type="button" class="quote-tab__close" data-quote-close="${esc(q.id)}" title="Fermer la cotation" aria-label="Fermer la cotation ${esc(label)}">${I.close}</button>`
              : ""
          }
        </div>`;
    })
    .join("");
  return `
    <div class="quote-tabs__list">${tabs}</div>
    <div class="quote-tabs__actions">
      <button class="btn btn--ghost btn--sm" data-quote-duplicate title="Dupliquer la cotation active">${I.copy} Dupliquer</button>
      <button class="btn btn--primary btn--sm" data-quote-new title="Nouvelle cotation">${I.plus} Nouvelle</button>
    </div>`;
}

function renderQuoteControls() {
  const tabs = document.querySelector("#quote-tabs");
  if (tabs) tabs.innerHTML = quoteTabsHtml();

  const project = document.querySelector("#project");
  if (project && project.value !== state.projectName) project.value = state.projectName;

  // Segmented période : reflète la cotation active (la période est par-cotation).
  document.querySelectorAll("#period-seg [data-period]").forEach((b) => {
    b.classList.toggle("is-active", Number(b.dataset.period) === state.period);
  });
}

function summarySkeleton() {
  const periodBtns = PERIODS.map(
    (p) => `<button type="button" data-period="${p}" class="${p === state.period ? "is-active" : ""}">${esc(periodLabel(p))}</button>`
  ).join("");
  const sizeBtns = SUMMARY_PRESETS.map(
    (p) => `<button class="size-btn" type="button" data-summary-size="${p.px}" title="${esc(p.title)} (${p.px}px)" aria-label="Largeur ${esc(p.title)}">${esc(p.label)}</button>`
  ).join("");
  return `
    <div class="summary">
      <div class="summary__resizer" title="Glisser pour redimensionner · double-clic pour réinitialiser" role="separator" aria-label="Redimensionner le panneau"></div>
      <div class="summary__head">
        <button class="summary__expand" type="button" data-summary-toggle title="Ouvrir le panier en grand" aria-label="Ouvrir le panier en grand" aria-expanded="false">${I.expand}</button>
        <h2>Résumé</h2>
        <span class="summary__badge" id="count-badge">0 ligne</span>
        <button class="btn btn--danger-ghost btn--sm" data-clear hidden id="clear-btn">Vider</button>
        <div class="summary__sizes" role="group" aria-label="Largeur du panneau">${sizeBtns}</div>
        <button class="summary__hide" type="button" data-summary-hide title="Masquer le panier : la page récupère la place" aria-label="Masquer le panier">${I.panelHide}</button>
      </div>
      <div class="summary__config ${state.cfgCollapsed ? "is-collapsed" : ""}">
        <button class="section-toggle" type="button" data-toggle-config aria-expanded="${state.cfgCollapsed ? "false" : "true"}" title="Replier / déplier la configuration"><span class="section-toggle__chev">${I.chevron}</span><span>Configuration</span></button>
        <div class="summary__config-body">
          <div class="field-block">
            <label for="project">Nom du projet</label>
            <input id="project" class="input" placeholder="Nommer cette cotation" title="Renomme l'onglet actif" value="${esc(state.projectName)}" />
          </div>
          <div class="field-block">
            <label>Durée du projet</label>
            <div class="segmented" id="period-seg" role="group" aria-label="Durée de projection">${periodBtns}</div>
          </div>
        </div>
      </div>
      <div class="summary__lines" id="summary-lines"></div>
      <div class="summary__totals" id="summary-totals"></div>
      <button class="history-save-btn" type="button" data-history-save title="Enregistrer ce devis dans l'historique">${I.save} Enregistrer le devis</button>
      <div class="summary__export" id="summary-export">
        <button class="export-btn" data-export="xlsx" title="Télécharger en Excel">${I.download} Excel</button>
        <button class="export-btn" data-export="pdf" title="Télécharger en PDF">${I.download} PDF</button>
        <button class="export-btn" data-export="html" title="Télécharger en HTML (imprimable)">${I.download} HTML</button>
      </div>
      <div class="summary__foot">Tarifs HT en euros · ${state.partner ? "tarifs partenaire" : "catalogue en prix publics"}</div>
    </div>`;
}

/* ---------- Panneau redimensionnable ---------- */
function readSummaryWidth() {
  const v = Number(localStorage.getItem(SUMMARY_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clamp(v, SUMMARY_MIN, SUMMARY_MAX) : SUMMARY_DEFAULT;
}

// Applique la largeur (bornée) à la grille via --summary-w, met à jour le preset
// actif et, sauf au boot, mémorise la valeur.
function applySummaryWidth(px, persist = true) {
  const w = clamp(Math.round(px), SUMMARY_MIN, SUMMARY_MAX);
  const layout = document.querySelector(".layout");
  if (layout) layout.style.setProperty("--summary-w", `${w}px`);
  document.querySelectorAll("[data-summary-size]").forEach((b) => {
    b.classList.toggle("is-active", Number(b.dataset.summarySize) === w);
  });
  if (persist) {
    try {
      localStorage.setItem(SUMMARY_WIDTH_KEY, String(w));
    } catch {
      /* stockage indisponible : non bloquant */
    }
  }
  return w;
}

// Glissement de la poignée : la largeur = bord droit de la grille − position du
// curseur (la poignée est sur le bord gauche du panneau, à droite de l'écran).
function wireResizer() {
  const layout = document.querySelector(".layout");
  const handle = document.querySelector(".summary__resizer");
  if (!layout || !handle) return;

  let dragging = false;
  let pendingWidth = readSummaryWidth();
  const onMove = (e) => {
    if (!dragging) return;
    pendingWidth = applySummaryWidth(layout.getBoundingClientRect().right - e.clientX, false);
    e.preventDefault();
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    applySummaryWidth(pendingWidth, true);
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
  };
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    e.preventDefault();
  });
  // Double-clic : retour à la largeur standard.
  handle.addEventListener("dblclick", () => applySummaryWidth(SUMMARY_DEFAULT));
}

// Micro-animation de la carte résumé (flottante) au scroll : ajoute .is-scrolling et
// data-scroll-dir pendant le défilement (léger soulèvement + ombre accentuée via CSS),
// retirée à l'arrêt. Câblé une seule fois sur window (mount() ré-rend tout #app).
let summaryScrollWired = false;
function wireSummaryScroll() {
  if (summaryScrollWired) return;
  summaryScrollWired = true;
  let lastY = window.scrollY || window.pageYOffset || 0;
  let ticking = false;
  let settle = null;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const el = document.querySelector(".summary");
        const y = window.scrollY || window.pageYOffset || 0;
        // Pas d'animation directionnelle quand le panier est en modale (sinon le
        // translate du scroll écraserait le centrage translate(-50%,-50%)).
        if (el && !state.summaryMax && Math.abs(y - lastY) > 1) {
          el.dataset.scrollDir = y > lastY ? "down" : "up";
          el.classList.add("is-scrolling");
          clearTimeout(settle);
          settle = setTimeout(() => el.classList.remove("is-scrolling"), 200);
        }
        lastY = y;
        ticking = false;
      });
    },
    { passive: true }
  );
}

// Bascule l'affichage « panier en grand » (modale) : classe sur <body> (le CSS recadre
// la carte au centre + affiche le fond), et mise à jour du bouton (icône/intitulé).
function applySummaryMax() {
  document.body.classList.toggle("summary-maximized", state.summaryMax);
  const btn = document.querySelector("[data-summary-toggle]");
  if (btn) {
    btn.innerHTML = state.summaryMax ? I.close : I.expand;
    btn.title = state.summaryMax ? "Réduire le panier" : "Ouvrir le panier en grand";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-expanded", state.summaryMax ? "true" : "false");
  }
}

// Applique l'état replié du bloc « Configuration » (le bloc persiste, pas de re-render).
// Panier masqué : la grille rend sa colonne, une pastille « Devis » le rouvre.
function setSummaryHidden(hidden) {
  state.summaryHidden = !!hidden;
  if (hidden && state.summaryMax) {
    state.summaryMax = false;
    applySummaryMax();
  }
  persistSummaryUi();
  applySummaryHidden();
}
function applySummaryHidden() {
  document.body.classList.toggle("summary-hidden", state.summaryHidden);
  renderSummaryPill();
}
function renderSummaryPill() {
  const pill = document.querySelector("#summary-pill");
  if (!pill) return;
  pill.hidden = !state.summaryHidden;
  if (!state.summaryHidden) return;
  const n = state.cart.length;
  const total = n && state.quote ? ` · <b>${esc(money(state.quote.monthly_discounted_total))}</b><span class="per">/mois</span>` : "";
  pill.innerHTML = `${I.cart}<span>Devis · ${plural(n, "ligne", "lignes")}${total}</span>`;
  pill.setAttribute("aria-label", `Afficher le panier : ${plural(n, "ligne", "lignes")}`);
}

function applyConfigCollapse() {
  const cfg = document.querySelector(".summary__config");
  if (cfg) cfg.classList.toggle("is-collapsed", state.cfgCollapsed);
  const tg = document.querySelector("[data-toggle-config]");
  if (tg) tg.setAttribute("aria-expanded", state.cfgCollapsed ? "false" : "true");
}

// Échap ferme la modale ouverte (historique prioritaire, puis panier). Câblé 1× sur document.
let summaryModalWired = false;
function wireSummaryModal() {
  if (summaryModalWired) return;
  summaryModalWired = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isConfirmOpen()) {
      closeConfirm(false);
    } else if (state.guide.open) {
      applyGuide({ type: "skip" });
    } else if (isHistoryOpen()) {
      closeHistory();
    } else if (state.summaryMax) {
      state.summaryMax = false;
      applySummaryMax();
    }
  });
}

/* ---------- Historique des devis (snapshots locaux) ---------- */
function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* stockage indisponible : non bloquant */
  }
}

// Fige le devis actif (lignes + durée + nom + total affiché) en tête d'historique.
function snapshotActiveQuote() {
  const q = activeQuote();
  if (!q.cart.length) return;
  const idx = state.quotes.findIndex((x) => x.id === q.id);
  const entry = {
    id: quoteId(),
    name: quoteLabel(q, idx),
    savedAt: new Date().toISOString(),
    period: q.period,
    cart: clone(q.cart),
    est: q.est ? clone(q.est) : null,
    monthly: state.quote ? state.quote.monthly_discounted_total : null,
    periodTotal: state.quote ? state.quote.period_discounted_total : null,
    partner: state.partner,
  };
  const list = loadHistory();
  list.unshift(entry);
  saveHistory(list);
  announce(`Devis « ${entry.name} » enregistré dans l'historique`); // [A4]
  if (isHistoryOpen()) renderHistoryList();
}

// Rouvre un devis enregistré : nouvelle cotation reconstruite depuis le snapshot
// (le chiffrage est recalculé à l'ouverture, prix du jour).
function reopenHistory(id) {
  const entry = loadHistory().find((e) => e.id === id);
  if (!entry) return;
  const q = createQuote(
    { name: entry.name, projectName: entry.name, cart: entry.cart, period: entry.period, est: entry.est ? sanitizeEstimate(entry.est) : null },
    state.quotes.length
  );
  state.quotes.push(q);
  closeHistory();
  setActiveQuote(q.id); // persiste + rend + planifie le recalcul
}
function deleteHistory(id) {
  saveHistory(loadHistory().filter((e) => e.id !== id));
  renderHistoryList();
}

function isHistoryOpen() {
  const m = document.querySelector("#history-modal");
  return !!m && m.classList.contains("is-open");
}
function openHistory() {
  const m = document.querySelector("#history-modal");
  if (!m) return;
  renderHistoryList();
  m.classList.add("is-open");
  document.body.classList.add("modal-open");
}
function closeHistory() {
  const m = document.querySelector("#history-modal");
  if (m) m.classList.remove("is-open");
  document.body.classList.remove("modal-open");
}

function renderHistoryList() {
  const root = document.querySelector("#history-list");
  if (!root) return;
  const list = loadHistory();
  if (!list.length) {
    root.innerHTML = `<div class="history-empty">${I.history}<div>Aucun devis enregistré.<br />Composez un devis puis cliquez « Enregistrer le devis ».</div></div>`;
    return;
  }
  root.innerHTML = list
    .map((e) => {
      const n = e.cart ? e.cart.length : 0;
      const total = e.monthly != null ? `${esc(money(e.monthly))}<span class="per">/mois</span>` : "—";
      const meta = `${esc(fmtDate(e.savedAt))} · ${num(n)} ligne${n > 1 ? "s" : ""}${e.partner ? " · tarifs partenaire" : ""}`;
      return `
        <div class="history-item">
          <div class="history-item__main">
            <div class="history-item__name">${esc(e.name)}</div>
            <div class="history-item__meta">${meta}</div>
          </div>
          <div class="history-item__total">${total}</div>
          <div class="history-item__actions">
            <button class="btn btn--ghost btn--sm" data-history-reopen="${esc(e.id)}">Rouvrir</button>
            <button class="btn btn--danger-ghost btn--icon btn--sm" data-history-delete="${esc(e.id)}" title="Supprimer" aria-label="Supprimer le devis ${esc(e.name)}">${I.trash}</button>
          </div>
        </div>`;
    })
    .join("");
}

/* ---------- Rendu : bandeau hors-ligne ---------- */
function renderBanner() {
  const slot = document.querySelector("#banner-slot");
  if (!slot) return;
  if (!state.dataStale || state.online || state.loading) {
    slot.innerHTML = "";
    return;
  }
  // Hors-ligne mais des données locales sont affichées : information non bloquante.
  if (state.catalog.length) {
    const srcLabel = state.dataSource === "cache" ? "votre dernière visite en ligne" : "snapshot embarqué";
    const when = state.dataSavedAt ? ` du ${esc(fmtDate(state.dataSavedAt))}` : "";
    const quoteText = state.quoteSource === "local" ? " Le résumé financier est calculé localement ; l'export reste indisponible tant que l'API ne répond pas." : "";
    slot.innerHTML = `
      <div class="banner banner--info">
        <span class="banner__icon">${I.warn}</span>
        <div>
          <div class="banner__title">Mode hors-ligne — données locales affichées</div>
          <div class="banner__text">API <code>${esc(apiBase)}</code> injoignable. Catalogue issu du ${srcLabel}${when} ; les montants peuvent être périmés.${quoteText}</div>
        </div>
        <div class="banner__actions">
          <button class="btn btn--sm" data-set-api>Changer l'URL</button>
          <button class="btn btn--primary btn--sm" data-retry>Réessayer</button>
        </div>
      </div>`;
    return;
  }
  // Aucune donnée disponible (ni cache, ni snapshot) : erreur franche.
  slot.innerHTML = `
    <div class="banner">
      <span class="banner__icon">${I.warn}</span>
      <div>
        <div class="banner__title">API indisponible sur <code>${esc(apiBase)}</code></div>
        <div class="banner__text">${esc(state.apiError || "Le backend FastAPI du calculateur doit être démarré.")}</div>
      </div>
      <div class="banner__actions">
        <button class="btn btn--sm" data-set-api>Changer l'URL</button>
        <button class="btn btn--primary btn--sm" data-retry>Réessayer</button>
      </div>
    </div>`;
}

/* ---------- Rendu : version applicative ----------
   La synchro QuoteFlow reste pilotée côté backend ; le front n'en affiche pas le
   statut. La version s'affiche en info-bulle au survol du logo (plus de pied de page). */
function renderVersion() {
  const brand = document.querySelector(".topbar .brand");
  if (!brand) return;
  const appVersion = state.appVersion || state.health?.version || "";
  brand.dataset.version = appVersion ? `Version ${appVersion}` : "";
}

/* ---------- Rendu : catalogue ---------- */
function matchProduct(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.sku} ${p.description} ${p.category} ${p.type} ${p.subType} ${p.tags.join(" ")}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}

// Compte les lignes du panier par famille (catalogue → familyId ; licences → "licenses").
function cartCountByFamily() {
  const map = new Map();
  state.cart.forEach((l) => {
    let fid = "licenses";
    if (l.source === "catalog") {
      const p = state.catalog.find((x) => x.sku === l.sku);
      fid = p ? p.familyId : "servicesfam";
    }
    map.set(fid, (map.get(fid) || 0) + 1);
  });
  return map;
}

/* ---------- Rendu : sidebar (navigation par famille) ---------- */
function renderSidebar() {
  const root = document.querySelector("#sidebar");
  if (!root) return;
  const q = state.search.trim().toLowerCase();
  const cartByFam = cartCountByFamily();

  let html = "";
  GROUPS.forEach((group) => {
    const items = FAMILIES.filter((f) => f.group === group.id)
      .map((f) => navItem(f, q, cartByFam))
      .filter(Boolean)
      .join("");
    if (!items) return;
    html += `<div class="sidebar__title">${esc(group.label)}</div>${items}`;
  });
  root.innerHTML = html;
}

function navItem(f, q, cartByFam) {
  let countHtml = "";
  if (f.kind === "estimate") {
    const active = !q && state.activeFamily === f.id;
    return `
    <button class="nav-item nav-item--start ${active ? "is-active" : ""}" data-family-nav="${f.id}" aria-current="${active ? "page" : "false"}">
      <span class="nav-item__ico">${familyIcon(f)}</span>
      <span class="nav-item__label">${esc(f.label)}</span>
    </button>`;
  }
  if (f.kind === "licenses") {
    const total = state.health?.license_items || (state.lic.loaded ? state.lic.all.length : 0);
    if (q) {
      countHtml = state.lic.loaded
        ? `<span class="nav-item__count"><em>${num(filteredLicenses().length)}</em></span>`
        : `<span class="nav-item__count">…</span>`;
    } else if (total) {
      countHtml = `<span class="nav-item__count">${num(total)}</span>`;
    }
  } else {
    const all = state.catalogByFamily.get(f.id) || [];
    if (!all.length) return ""; // famille vide → masquée
    countHtml = q
      ? `<span class="nav-item__count"><em>${num(all.filter((p) => matchProduct(p, q)).length)}</em></span>`
      : `<span class="nav-item__count">${num(all.length)}</span>`;
  }
  const cart = cartByFam.get(f.id) || 0;
  const cartHtml = cart ? `<span class="nav-item__cart" title="${num(cart)} au panier">${num(cart)}</span>` : "";
  const active = !q && f.id === state.activeFamily;
  return `
    <button class="nav-item ${active ? "is-active" : ""}" data-family-nav="${f.id}" aria-current="${active ? "page" : "false"}">
      <span class="nav-item__ico">${familyIcon(f)}</span>
      <span class="nav-item__label">${esc(f.label)}</span>
      ${cartHtml}${countHtml}
    </button>`;
}

/* ---------- Rendu : colonne centrale (aiguillage) ---------- */
function renderMain() {
  const body = document.querySelector("#main-body");
  if (!body) return;
  renderModeSwitch();

  if (state.loading) {
    body.innerHTML = `<div class="loading-block"><div class="spinner"></div>Chargement du catalogue…</div>`;
    return;
  }
  if (!state.catalog.length) {
    body.innerHTML = `<div class="loading-block">${
      state.online ? "Aucun produit dans le catalogue." : "Catalogue indisponible : API hors ligne et aucune donnée locale."
    }</div>`;
    return;
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    renderSearchView(body, q);
    return;
  }

  const fam = FAMILIES.find((f) => f.id === state.activeFamily) || FAMILIES[0];
  if (fam.kind === "estimate") {
    // Assistant ouvert : il porte les champs de saisie ; la vue reste vide pour
    // que les identifiants (#est-servers…) n'existent qu'une fois dans la page.
    if (state.guide.open) body.innerHTML = "";
    else renderEstimateView(body);
    return;
  }
  if (fam.kind === "licenses") {
    renderLicensesView(body, fam);
    return;
  }
  renderFamilyView(body, fam);
}

function renderFamilyView(body, fam) {
  const all = state.catalogByFamily.get(fam.id) || [];

  // Sous-familles (sub_type) : onglets si ≥2 valeurs distinctes (wrap si nombreuses).
  const subs = [...new Set(all.map((p) => p.subType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const activeSub = state.subfamily && subs.includes(state.subfamily) ? state.subfamily : "";
  const items = activeSub ? all.filter((p) => p.subType === activeSub) : all;

  let subfamilyHtml = "";
  if (subs.length >= 2) {
    subfamilyHtml = `
      <div class="subfamily" role="group" aria-label="Sous-famille ${esc(fam.label)}">
        <button type="button" class="${activeSub === "" ? "is-active" : ""}" data-subfamily="">Toutes</button>
        ${subs
          .map((s) => `<button type="button" class="${activeSub === s ? "is-active" : ""}" data-subfamily="${esc(s)}">${esc(prettify(s))}</button>`)
          .join("")}
      </div>`;
  }

  // Encart : le visiteur qui raisonne en serveurs (vCPU / RAM) est renvoyé vers l'estimation guidée.
  const callout =
    fam.id === "compute"
      ? `<div class="callout">${I.bulb}<span>Vous raisonnez en serveurs (vCPU, mémoire, disque) plutôt qu'en références ? <button type="button" class="linkish" data-family-nav="estimate">Estimez votre projet</button> : nous comparons pour vous VM mutualisées et serveurs dédiés.</span></div>`
      : "";

  const countLabel = activeSub
    ? `<em>${num(items.length)}</em> / ${num(all.length)} référence${all.length > 1 ? "s" : ""}`
    : `${num(items.length)} référence${items.length > 1 ? "s" : ""}`;

  const head = `
    <div class="main__head">
      <h1 class="main__title">${esc(fam.label)}</h1>
      <span class="main__count">${countLabel}</span>
    </div>
    <p class="main__desc">${esc(fam.tag)}. Prix publics affichés${state.partner ? " — tarifs partenaire actifs" : ""}.</p>`;

  const grid = items.length
    ? `<div class="product-grid">${items.map((p) => productCard(p, fam)).join("")}</div>`
    : `<div class="loading-block">Aucune référence dans cette sélection.</div>`;

  body.innerHTML = head + subfamilyHtml + callout + grid;
}

function renderLicensesView(body, fam) {
  const total = state.health?.license_items || (state.lic.loaded ? state.lic.all.length : 0);
  body.innerHTML = `
    <div class="main__head">
      <h1 class="main__title">${esc(fam.label)}</h1>
      <span class="main__count">${total ? `${num(total)} références` : "—"}</span>
    </div>
    <p class="main__desc">${esc(fam.tag)}. Filtrez par éditeur ou par terme ; les prix sont term-aware (mensuel, annuel, pluriannuel, perpétuel).</p>
    ${licensePanelShell()}`;
  // [G1] licensePanelShell() vient de recréer des <select> vides. Le flag, sinon
  // jamais réinitialisé, ferait sortir populateLicenseFilters() en court-circuit et
  // laisserait les filtres éditeur/terme vides à chaque remontage de la vue.
  licenseFiltersReady = false;
  loadLicenses(); // idempotent : charge si besoin, sinon affichage immédiat ci-dessous
  renderLicenseResults();
}

// Vue recherche globale : produits (groupés par famille) + licences correspondantes.
function renderSearchView(body, q) {
  // Charge les licences une seule fois pour qu'elles participent aux résultats.
  if (!state.lic.loaded && !state.lic.loading) {
    loadLicenses().then(() => {
      if (state.search.trim()) {
        renderMain();
        renderSidebar();
      }
    });
  }

  let prodMatches = 0;
  let famMatches = 0;
  let sections = "";
  GROUPS.forEach((group) => {
    FAMILIES.filter((f) => f.group === group.id && f.kind !== "licenses").forEach((f) => {
      const items = (state.catalogByFamily.get(f.id) || []).filter((p) => matchProduct(p, q));
      if (!items.length) return;
      prodMatches += items.length;
      famMatches += 1;
      sections += `
        <div class="main__section">${esc(f.label)} · ${num(items.length)}</div>
        <div class="product-grid">${items.map((p) => productCard(p, f)).join("")}</div>`;
    });
  });

  const licMatches = state.lic.loaded ? filteredLicenses().length : null;

  const parts = [];
  if (prodMatches) parts.push(`<strong>${num(prodMatches)}</strong> produit${prodMatches > 1 ? "s" : ""} dans ${num(famMatches)} famille${famMatches > 1 ? "s" : ""}`);
  if (licMatches === null) parts.push("recherche des licences…");
  else if (licMatches) parts.push(`<strong>${num(licMatches)}</strong> licence${licMatches > 1 ? "s" : ""}`);
  const summaryText = parts.length ? parts.join(" · ") : "Aucun résultat";

  let html = `
    <div class="search-summary">
      <span class="search-summary__txt">${summaryText} pour « ${esc(state.search.trim())} »</span>
      <button class="search-summary__clear" data-clear-search>Effacer</button>
    </div>`;
  html += sections;
  if (licMatches) {
    html += `<div class="main__section">Licences · ${num(licMatches)}</div>${licenseResultsShell()}`;
  }
  if (!prodMatches && licMatches === 0) {
    html += `<div class="loading-block">Aucun résultat pour « ${esc(state.search.trim())} ».</div>`;
  }

  body.innerHTML = html;
  if (licMatches) renderLicenseResults();
}

// Conteneur léger des résultats licences en recherche globale (sans toolbar dédiée :
// le filtre est piloté par la recherche globale). Réutilise renderLicenseResults().
function licenseResultsShell() {
  return `<div class="lic"><div id="lic-results"></div><div class="lic-pager" id="lic-pager"></div></div>`;
}

function productCard(p, fam) {
  const line = findLine(p.sku, p.source);
  const open = state.openCards.has(p.sku);
  const hasSpecs = specEntries(p).length > 0;
  const tag = p.subType ? prettify(p.subType) : fam ? fam.label : prettify(p.category);

  const metaChips = [
    p.snc === "yes" ? `<span class="chip chip--snc">SecNumCloud</span>` : "",
    p.snc === "pending" ? `<span class="chip chip--pending">SecNumCloud en cours</span>` : "",
    p.engagement && engagementMonths(p.engagement) > 1 ? `<span class="chip chip--eng">${esc(p.engagement)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const action = line
    ? stepper(p.sku, p.source, line.quantity)
    : `<div class="add-control">
         <input class="qty-input" type="number" min="${p.minQty}" step="1" value="${p.baseQty}" data-qty-input="${esc(lineKey(p.sku, p.source))}" aria-label="Quantité" />
         <button class="btn btn--primary btn--sm" data-add="${esc(p.sku)}">Ajouter</button>
       </div>`;

  // Détail toujours disponible : il porte la référence (SKU), retirée de la carte.
  const toggle = `<button class="pc__details-toggle" type="button" data-card-toggle="${esc(p.sku)}" aria-expanded="${open ? "true" : "false"}">${I.chevron} ${open ? "Masquer le détail" : "Voir le détail"}</button>`;
  const specTable = open ? `<div class="spec-table">${specRowsHtml(p)}</div>` : "";

  return `
    <div class="product-card ${line ? "is-in-cart" : ""} ${open ? "is-open" : ""}">
      <div class="pc__top">
        <div class="pc__id">
          <div class="pc__name">${highlight(p.name, state.search)}</div>
          <span class="pc__unit">unité : ${esc(p.unit)}</span>
        </div>
        <span class="pc__tag ${p.source === "license" ? "lic" : ""}">${esc(tag)}</span>
      </div>
      ${p.description ? `<div class="pc__desc">${highlight(p.description, state.search)}</div>` : ""}
      ${hasSpecs ? `<div class="spec-chips">${specChipsHtml(p)}</div>` : ""}
      <div class="spec-chips">${metaChips}</div>
      ${specTable}
      <div class="pc__foot">
        <div class="pc__price">${cardPriceHtml(p)}</div>
        <div class="pc__actions">${action}</div>
      </div>
      ${toggle}
    </div>`;
}

function stepper(sku, source, qty) {
  const k = esc(lineKey(sku, source));
  return `
    <div class="stepper">
      <button data-step="dec" data-sku="${esc(sku)}" data-source="${source}" aria-label="Diminuer">−</button>
      <input type="number" min="1" value="${qty}" data-qty-edit="${k}" data-sku="${esc(sku)}" data-source="${source}" aria-label="Quantité" />
      <button data-step="inc" data-sku="${esc(sku)}" data-source="${source}" aria-label="Augmenter">+</button>
    </div>`;
}

/* ---------- Rendu : panneau licences ---------- */
function licensePanelShell() {
  return `
    <div class="lic">
      <div class="lic-toolbar">
        <div class="search-box">
          ${I.search}
          <input id="lic-q" class="input" placeholder="Rechercher une licence (nom, SKU, éditeur…)" value="${esc(state.lic.query)}" />
        </div>
        <select id="lic-vendor" class="input"><option value="">Tous éditeurs</option></select>
        <select id="lic-term" class="input"><option value="">Tous termes</option></select>
        <span class="lic-count" id="lic-count">—</span>
      </div>
      <div id="lic-results"></div>
      <div class="lic-pager" id="lic-pager"></div>
    </div>`;
}

function filteredLicenses() {
  const { query, vendor, term } = state.lic;
  const q = query.trim().toLowerCase();
  return state.lic.all.filter((l) => {
    if (vendor && l.vendor !== vendor) return false;
    if (term && l.term !== term) return false;
    if (q && !q.split(/\s+/).filter(Boolean).every((tok) => l.search.includes(tok))) return false;
    return true;
  });
}

function renderLicenseResults() {
  const results = document.querySelector("#lic-results");
  const pager = document.querySelector("#lic-pager");
  const count = document.querySelector("#lic-count");
  if (!results) return;

  if (state.lic.loading) {
    results.innerHTML = `<div class="lic-loading"><div class="spinner"></div>Chargement de ${num(state.health?.license_items || 8000)} licences…</div>`;
    if (pager) pager.innerHTML = "";
    if (count) count.textContent = "—";
    return;
  }
  if (state.lic.error) {
    results.innerHTML = `<div class="lic-empty">${esc(state.lic.error)}</div>`;
    return;
  }
  if (!state.lic.loaded) {
    results.innerHTML = `<div class="lic-empty">Ouverture du catalogue de licences…</div>`;
    return;
  }

  populateLicenseFilters();

  const filtered = filteredLicenses();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.lic.page > pages) state.lic.page = pages;
  const start = (state.lic.page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  if (count) count.textContent = `${num(filtered.length)} / ${num(state.lic.all.length)}`;

  if (!slice.length) {
    results.innerHTML = `<div class="lic-empty">Aucune licence ne correspond à ces critères.</div>`;
    if (pager) pager.innerHTML = "";
    return;
  }

  results.innerHTML = `<div class="lic-table">${slice.map(licenseRow).join("")}</div>`;

  if (pager) {
    pager.innerHTML = `
      <span>${num(filtered.length)} licence${filtered.length > 1 ? "s" : ""} · page ${state.lic.page}/${pages}</span>
      <span class="lic-pager__nav">
        <button class="btn btn--sm" data-lic-page="prev" ${state.lic.page <= 1 ? "disabled" : ""}>← Préc.</button>
        <button class="btn btn--sm" data-lic-page="next" ${state.lic.page >= pages ? "disabled" : ""}>Suiv. →</button>
      </span>`;
  }
}

let licenseFiltersReady = false;
function populateLicenseFilters() {
  if (licenseFiltersReady) return;
  const vendorSel = document.querySelector("#lic-vendor");
  const termSel = document.querySelector("#lic-term");
  if (!vendorSel || !termSel) return;
  const vendors = [...new Set(state.lic.all.map((l) => l.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  vendorSel.innerHTML =
    `<option value="">Tous éditeurs</option>` +
    vendors.map((v) => `<option value="${esc(v)}" ${state.lic.vendor === v ? "selected" : ""}>${esc(v)}</option>`).join("");
  const terms = [...new Set(state.lic.all.map((l) => l.term).filter(Boolean))];
  termSel.innerHTML =
    `<option value="">Tous termes</option>` +
    terms.map((t) => `<option value="${esc(t)}" ${state.lic.term === t ? "selected" : ""}>${esc(termLabel(t))}</option>`).join("");
  licenseFiltersReady = true;
}

function licenseRow(l) {
  const line = findLine(l.sku, l.source);
  const hasDisc = state.partner && l.discountPct > 0;
  const action = line
    ? stepper(l.sku, l.source, line.quantity)
    : `<button class="icon-btn" data-add="${esc(l.sku)}" data-source="license" title="Ajouter">+</button>`;
  return `
    <div class="lic-row ${line ? "is-in-cart" : ""}">
      <span class="lic-row__sku">${highlight(l.sku, state.lic.query)}</span>
      <span class="lic-row__name" title="${esc(l.name)}">${highlight(l.name, state.lic.query)}</span>
      <span class="lic-row__vendor">${highlight(l.vendor, state.lic.query)}</span>
      <span class="lic-row__term">${l.term ? `<span class="chip">${esc(termLabel(l.term))}</span>` : ""}</span>
      <span class="lic-row__price">${esc(money(hasDisc ? l.discountedPrice : l.publicPrice))}</span>
      <span class="lic-row__action">${action}</span>
    </div>`;
}

/* ---------- Rendu : résumé financier ---------- */
function renderSummaryLines() {
  const root = document.querySelector("#summary-lines");
  const badge = document.querySelector("#count-badge");
  const clearBtn = document.querySelector("#clear-btn");
  if (!root) return;
  // [G3] runQuote() rappelle cette fonction ~220 ms après un clic stepper (recalcul
  // async) et reconstruit les steppers du résumé : on préserve le focus ici aussi,
  // sinon il serait reperdu après la restauration synchrone d'afterCartChange().
  const focus = captureStepperFocus();

  if (badge) badge.textContent = `${state.cart.length} ligne${state.cart.length > 1 ? "s" : ""}`;
  if (clearBtn) clearBtn.hidden = state.cart.length === 0;
  document.querySelectorAll("#summary-export .export-btn").forEach((b) => {
    if (!b.dataset.busy) {
      b.dataset.defaultTitle ||= b.title;
      b.disabled = state.cart.length === 0 || state.quoteSource === "local";
      b.title = state.quoteSource === "local" ? "Export indisponible hors-ligne" : b.dataset.defaultTitle;
    }
  });
  // « Enregistrer le devis » : actif dès qu'il y a des lignes (l'historique est local,
  // donc disponible même hors-ligne, contrairement aux exports serveur).
  const saveBtn = document.querySelector("[data-history-save]");
  if (saveBtn) saveBtn.disabled = state.cart.length === 0;

  if (!state.cart.length) {
    root.innerHTML = `
      <div class="summary__empty">
        ${I.cart}
        <div>Votre devis est vide.<br />Estimez votre projet, ou parcourez le catalogue et ajoutez des produits.</div>
      </div>`;
    renderSummaryPill();
    return;
  }

  root.innerHTML = state.cart
    .map((l) => {
      const ql = quoteLineFor(l.sku, l.source);
      const unit = ql?.unit || l.unit || "unité";
      const recurring = ql ? ql.recurring !== false : true;
      const months = ql?.term_months || 1;
      const nativePub = ql ? ql.public_unit_price : null; // prix natif public (par terme)
      const nativeNet = ql ? ql.discounted_unit_price : null;
      const monthlyNet = ql ? ql.monthly_total : null; // mensuel amorti (récurrent) ou 0
      const oneTime = ql ? ql.one_time_total : null; // coût ponctuel ou 0
      const headlineNet = ql ? (recurring ? monthlyNet : oneTime) : null;
      // Prix public ramené au même horizon que le net affiché (mensuel amorti / ponctuel).
      const headlinePub = ql ? (recurring ? (nativePub / months) * l.quantity : nativePub * l.quantity) : null;
      const showPub = headlinePub !== null && headlineNet !== null && headlinePub > headlineNet + 0.001;
      const engTot = ql && ql.engagement_total ? ql.engagement_total : null;
      const showEng = !!(ql && recurring && engTot && ql.engagement_months > 1);

      const sub = ql ? `${num(l.quantity)} × ${money(nativeNet)}${lineTermSuffix(ql)}` : `${num(l.quantity)} × ${esc(unit)}`;

      // Chips remises (la nature du terme est portée par le term-chip de l'en-tête).
      const meta = [];
      if (ql && ql.standard_discount_percent > 0) meta.push(`<span class="cl-chip cl-chip--std">−${num(ql.standard_discount_percent)}% partenaire</span>`);
      if (state.partner && state.discount > 0 && recurring) meta.push(`<span class="cl-chip cl-chip--com">−${num(state.discount)}% engagement</span>`);

      // Détail exhaustif par ligne (term-aware). En mode public (aucune remise), on
      // n'affiche PAS de « PU net » dupliqué ni de prix barré identique.
      let details = "";
      if (ql) {
        const std = ql.standard_discount_percent || 0;
        const com = state.partner ? state.discount || 0 : 0;
        const afterStd = nativePub * (1 - std / 100);
        const hasDisc = std > 0 || com > 0;
        const row = (lbl, val, cls = "") =>
          `<div class="cld-row ${cls}"><span class="cld-lbl">${esc(lbl)}</span><span class="cld-val">${val}</span></div>`;
        const rows = [];
        rows.push(row("Prix unitaire", `${esc(money(nativePub))} <small>/ ${esc(unit)} · ${esc(lineTermWord(ql))}</small>`));
        if (std > 0) {
          rows.push(row("Remise partenaire", `<span class="cld-neg">−${num(std)} %</span>`));
          rows.push(row("Après remise partenaire", `${esc(money(afterStd))} <small>/ ${esc(unit)}</small>`));
        }
        if (com > 0) rows.push(row("Remise engagement", `<span class="cld-neg">−${num(com)} %</span>`));
        if (hasDisc) rows.push(row("PU net", `${esc(money(nativeNet))} <small>/ ${esc(unit)}</small>`, "cld-row--accent"));
        rows.push(row("Quantité", `× ${num(l.quantity)}`));
        if (recurring && months > 1) {
          rows.push(row("Mensuel équivalent", `${esc(money(monthlyNet))} <small>(${esc(money(nativeNet))} ÷ ${num(months)} mois)</small>`, "cld-row--strong"));
        } else if (recurring) {
          rows.push(row("Mensuel net", `${esc(money(monthlyNet))} <small>/mois</small>`, "cld-row--strong"));
        } else {
          rows.push(row("Coût ponctuel", `${esc(money(oneTime))} <small>à l'achat</small>`, "cld-row--strong"));
        }
        if (showEng) rows.push(row("Total sur l'engagement", esc(money(engTot)), "cld-row--strong"));
        details = `<div class="cart-line__details">${rows.join("")}</div>`;
      }

      const k = lineKey(l.sku, l.source);
      const open = state.openLines.has(k);
      const headline = headlineNet === null ? "…" : esc(money(recurring ? monthlyNet : oneTime));
      const per = recurring ? "/ mois" : "ponctuel";

      return `
        <div class="cart-line ${open ? "is-open" : ""}">
          <div class="cart-line__head">
            <span class="cart-line__info">
              <span class="cart-line__name" title="${esc(ql?.name || l.name)}">${esc(ql?.name || l.name)}</span>
              <span class="cart-line__meta">${termChipHtml(ql)}${meta.join("")}<span>${sub}</span></span>
            </span>
            <span class="cart-line__price">
              ${showPub ? `<span class="pub">${esc(money(headlinePub))}</span>` : ""}
              <b>${headline}</b><span class="per">${per}</span>
              ${showEng ? `<span class="eng-tot">${esc(money(engTot))} / engagement</span>` : ""}
            </span>
          </div>
          <div class="cart-line__ctrl">
            ${stepper(l.sku, l.source, l.quantity)}
            ${
              details
                ? `<button class="cart-line__more" type="button" data-card-line="${esc(k)}" aria-expanded="${open ? "true" : "false"}">${open ? "Masquer le détail" : "Détail du prix"}${I.chevron}</button>`
                : ""
            }
            <button class="btn btn--danger-ghost btn--sm btn--icon cart-line__remove" data-remove="${esc(l.sku)}" data-source="${l.source}" title="Retirer du devis" aria-label="Retirer ${esc(ql?.name || l.name)} du devis">${I.trash}</button>
          </div>
          ${open ? details : ""}
        </div>`;
    })
    .join("");
  restoreStepperFocus(focus); // [G3] focus préservé à travers le rebuild du résumé
  renderSummaryPill();
}

// Libellé de famille pour une ligne de devis (sert au regroupement du résumé et de l'export).
function familyLabelForLine(ql) {
  if (ql.source === "license") return "Licences éditeurs";
  const p = state.catalog.find((x) => x.sku === ql.sku);
  const fam = p && FAMILIES.find((f) => f.id === p.familyId);
  return fam ? fam.label : "Autres";
}

const periodLabel = (months) =>
  months === 1 ? "1 mois" : months % 12 === 0 ? `${months / 12} an${months / 12 > 1 ? "s" : ""}` : `${months} mois`;

function renderSummaryTotals() {
  const root = document.querySelector("#summary-totals");
  if (!root) return;

  if (!state.cart.length) {
    root.innerHTML = "";
    return;
  }
  if (state.quoteError) {
    root.innerHTML = `<div class="total-sub" style="color:var(--danger)">${esc(state.quoteError)}</div>`;
    return;
  }
  const q = state.quote;
  if (!q) {
    root.innerHTML = `<div class="total-sub">${state.quoteLoading ? "Calcul en cours…" : ""}</div>`;
    return;
  }

  const monthsLabel = periodLabel(state.period);

  // Répartition mensuelle par famille.
  const byFamily = new Map();
  q.lines.forEach((ql) => {
    const key = familyLabelForLine(ql);
    const acc = byFamily.get(key) || { monthly: 0, count: 0 };
    acc.monthly += ql.monthly_total;
    acc.count += 1;
    byFamily.set(key, acc);
  });
  const famRows = [...byFamily.entries()]
    .sort((a, b) => b[1].monthly - a[1].monthly)
    .map(
      ([label, v]) =>
        `<div class="fam-row"><span class="fam-row__lbl">${esc(label)}<span class="fam-row__n">${num(v.count)}</span></span><span class="fam-row__val">${esc(money(v.monthly))}<span class="per">/mois</span></span></div>`
    )
    .join("");

  // Répartition des remises (mensuel) — lignes récurrentes, au mensuel AMORTI
  // (cohérent avec monthly_discounted_total). Les ponctuels sont exclus.
  let stdSaving = 0;
  let afterStd = 0;
  q.lines.forEach((ql) => {
    if (ql.recurring === false) return;
    const months = ql.term_months || 1;
    const pubM = (ql.public_unit_price / months) * ql.quantity;
    const afterStdM = (ql.public_unit_price * (1 - (ql.standard_discount_percent || 0) / 100) / months) * ql.quantity;
    stdSaving += pubM - afterStdM;
    afterStd += afterStdM;
  });
  const comSaving = afterStd * ((q.discount_percent || 0) / 100);

  const breakdown = [];
  if (stdSaving > 0.005) breakdown.push(`<div class="total-row total-row--sub"><span class="lbl">↳ dont remise partenaire</span><span class="val">−${esc(money(stdSaving))}</span></div>`);
  if (comSaving > 0.005) breakdown.push(`<div class="total-row total-row--sub"><span class="lbl">↳ dont remise engagement</span><span class="val">−${esc(money(comSaving))}</span></div>`);

  // « Mensuel public » barré n'a de sens qu'en présence d'une remise récurrente
  // (sinon il est identique au net -> bruit en mode public).
  const showMonthlyPublic = q.monthly_public_total > q.monthly_discounted_total + 0.005;
  const hasOneTime = q.one_time_total > 0.005;

  // « Détail financier » repliable : le Total mensuel net (et les coûts ponctuels)
  // restent TOUJOURS visibles ; seul le détail (répartition, remises, projection,
  // engagement, économie) se replie pour laisser plus de place aux lignes du panier.
  const collapsed = state.totalsCollapsed;
  root.innerHTML = `
    <div class="total-row total-row--main">
      <span class="lbl">Total mensuel net</span>
      <span class="val">${esc(money(q.monthly_discounted_total))}<span class="per per--main">/mois</span></span>
    </div>
    ${hasOneTime ? `<div class="total-row total-row--onetime"><span class="lbl">Coûts ponctuels <small>(à l'achat)</small></span><span class="val">${esc(money(q.one_time_total))}</span></div>` : ""}
    <button class="totals-more" type="button" data-toggle-totals aria-expanded="${collapsed ? "false" : "true"}">${collapsed ? "Voir le détail financier" : "Masquer le détail financier"}${I.chevron}</button>
    <div class="totals-detail ${collapsed ? "is-collapsed" : ""}">
      ${byFamily.size > 1 ? `<div class="fam-block"><div class="fam-block__title">Répartition mensuelle</div>${famRows}</div>` : ""}
      ${showMonthlyPublic ? `<div class="total-row total-row--muted"><span class="lbl">Mensuel public</span><span class="val">${esc(money(q.monthly_public_total))}</span></div>` : ""}
      ${breakdown.join("")}
      <div class="total-row"><span class="lbl">Coût sur ${esc(monthsLabel)}</span><span class="val">${esc(money(q.period_discounted_total))}</span></div>
      ${
        // Engagement contractuel minimum (somme des durées minimales par produit) :
        // affiché seulement s'il diffère d'un simple mois, pour ne pas le confondre
        // avec la durée du projet choisie ci-dessus.
        q.total_on_engagement > q.monthly_discounted_total + q.one_time_total + 0.005
          ? `<div class="total-row" title="Montant dû sur la durée minimale d'engagement de chaque produit (par exemple 12 mois pour certaines lames GPU)"><span class="lbl">Engagement minimum du contrat</span><span class="val">${esc(money(q.total_on_engagement))}</span></div>`
          : ""
      }
      ${q.savings_total > 0.005 ? `<div class="total-row total-row--save"><span class="lbl">Économie sur ${esc(monthsLabel)}</span><span class="val">${esc(money(q.savings_total))}</span></div>` : ""}
    </div>
    ${state.quoteSource === "local" ? `<div class="total-sub">Calcul local hors-ligne · export indisponible jusqu'au retour de l'API</div>` : ""}
    ${state.quoteLoading ? `<div class="total-sub">Mise à jour…</div>` : ""}`;
  renderSummaryPill();
}

/* ---------- Rendu global ---------- */
function render() {
  renderQuoteControls();
  renderBanner();
  renderSidebar();
  renderMain();
  renderSummaryLines();
  renderSummaryTotals();
  // Pied du résumé : reflète le mode (public/partenaire) piloté par la config.
  const foot = document.querySelector(".summary__foot");
  if (foot) foot.textContent = `Tarifs HT en euros · ${state.partner ? "tarifs partenaire" : "catalogue en prix publics"}`;
  renderVersion();
}

/* ---------- Événements ---------- */
function wireEvents() {
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onChange);
}

function onClick(e) {
  const t = e.target.closest("[data-family-nav],[data-subfamily],[data-card-toggle],[data-card-line],[data-period],[data-add],[data-step],[data-remove],[data-clear],[data-clear-search],[data-export],[data-lic-page],[data-set-api],[data-retry],[data-quote-switch],[data-quote-new],[data-quote-duplicate],[data-quote-close],[data-summary-size],[data-summary-toggle],[data-summary-close],[data-toggle-config],[data-toggle-totals],[data-history-open],[data-history-close],[data-history-save],[data-history-reopen],[data-history-delete],[data-est-usage],[data-est-size],[data-est-qty],[data-est-custom],[data-est-remove],[data-est-add],[data-est-class],[data-est-detail],[data-est-choose],[data-est-done-close],[data-mode],[data-confirm],[data-summary-hide],[data-summary-show],[data-guide-replay],[data-guide-mode],[data-guide-next],[data-guide-back],[data-guide-skip],[data-guide-goto],[data-guide-open]");
  if (!t) return;

  if (t.dataset.confirm) {
    closeConfirm(t.dataset.confirm === "ok");
    return;
  }
  if (onGuideClick(t)) return;
  if (onEstimateClick(t)) return;

  // Panier masqué : la colonne centrale récupère la place, une pastille le rouvre.
  if (t.hasAttribute("data-summary-hide")) {
    setSummaryHidden(true);
    document.querySelector("#summary-pill")?.focus();
    return;
  }
  if (t.hasAttribute("data-summary-show")) {
    setSummaryHidden(false);
    document.querySelector("[data-summary-hide]")?.focus();
    return;
  }

  // Historique des devis (snapshots locaux).
  if (t.hasAttribute("data-history-open")) {
    openHistory();
    return;
  }
  if (t.hasAttribute("data-history-close")) {
    closeHistory();
    return;
  }
  if (t.hasAttribute("data-history-save")) {
    snapshotActiveQuote();
    return;
  }
  if (t.dataset.historyReopen) {
    reopenHistory(t.dataset.historyReopen);
    return;
  }
  if (t.dataset.historyDelete) {
    deleteHistory(t.dataset.historyDelete);
    return;
  }

  // Ouvrir / fermer le panier en grand (modale).
  if (t.hasAttribute("data-summary-toggle")) {
    if (state.summaryHidden) setSummaryHidden(false);
    state.summaryMax = !state.summaryMax;
    applySummaryMax();
    return;
  }
  if (t.hasAttribute("data-summary-close")) {
    state.summaryMax = false;
    applySummaryMax();
    return;
  }

  // Replier / déplier le bloc « Configuration » (nom + projection).
  if (t.hasAttribute("data-toggle-config")) {
    state.cfgCollapsed = !state.cfgCollapsed;
    persistSummaryUi();
    applyConfigCollapse();
    return;
  }

  // Replier / déplier le « Détail financier » (le total reste visible).
  if (t.hasAttribute("data-toggle-totals")) {
    state.totalsCollapsed = !state.totalsCollapsed;
    persistSummaryUi();
    renderSummaryTotals();
    document.querySelector("[data-toggle-totals]")?.focus();
    return;
  }


  // Navigation par famille (sidebar) : quitte la recherche, réinitialise la sous-famille.
  if (t.dataset.familyNav) {
    state.activeFamily = t.dataset.familyNav;
    setMode(state.activeFamily === "estimate" ? "guided" : "free");
    state.subfamily = "";
    state.openCards.clear();
    if (state.search) {
      state.search = "";
      state.lic.query = "";
      state.lic.page = 1;
      const input = document.querySelector("#q-global");
      if (input) input.value = "";
    }
    if (state.activeFamily === "licenses") loadLicenses();
    renderSidebar();
    renderMain();
    return;
  }

  // Sous-famille (sub_type). Attention : data-subfamily="" est falsy → tester l'attribut.
  if (t.hasAttribute("data-subfamily")) {
    state.subfamily = t.dataset.subfamily || "";
    renderMain();
    return;
  }

  // Dépli/repli du détail specs d'une carte.
  if (t.dataset.cardToggle) {
    const sku = t.dataset.cardToggle;
    if (state.openCards.has(sku)) state.openCards.delete(sku);
    else state.openCards.add(sku);
    renderMain();
    return;
  }

  // Dépli/repli d'une ligne du devis.
  if (t.dataset.cardLine) {
    const k = t.dataset.cardLine;
    if (state.openLines.has(k)) state.openLines.delete(k);
    else state.openLines.add(k);
    renderSummaryLines();
    document.querySelector(`[data-card-line="${CSS.escape(k)}"]`)?.focus();
    return;
  }

  // Durée d'engagement / projection (segmented control).
  if (t.dataset.period) {
    state.period = Number(t.dataset.period) || 12;
    persistQuotes();
    document.querySelectorAll("#period-seg [data-period]").forEach((b) => {
      b.classList.toggle("is-active", Number(b.dataset.period) === state.period);
    });
    scheduleQuote();
    renderSummaryTotals();
    return;
  }

  if (t.dataset.summarySize) {
    applySummaryWidth(Number(t.dataset.summarySize));
    return;
  }

  if (t.dataset.quoteClose) {
    e.stopPropagation();
    closeQuote(t.dataset.quoteClose);
    return;
  }

  if (t.dataset.quoteSwitch) {
    setActiveQuote(t.dataset.quoteSwitch);
    return;
  }

  if (t.hasAttribute("data-quote-new")) {
    addQuote();
    return;
  }

  if (t.hasAttribute("data-quote-duplicate")) {
    duplicateQuote();
    return;
  }

  if (t.dataset.export) {
    exportQuote(t.dataset.export, t);
    return;
  }

  if (t.hasAttribute("data-clear-search")) {
    state.search = "";
    state.lic.query = "";
    state.lic.page = 1;
    const input = document.querySelector("#q-global");
    if (input) input.value = "";
    renderSidebar();
    renderMain();
    return;
  }

  if (t.dataset.add) {
    const sku = t.dataset.add;
    const source = t.dataset.source || "catalog";
    addProduct(sku, source);
    return;
  }

  if (t.dataset.step) {
    const { sku, source } = t.dataset;
    bumpLine(sku, source, t.dataset.step === "inc" ? 1 : -1);
    resizeSupportAfterEdit(sku);
    afterCartChange(source);
    return;
  }

  if (t.dataset.remove) {
    removeLine(t.dataset.remove, t.dataset.source || "catalog");
    resizeSupportAfterEdit(t.dataset.remove);
    afterCartChange(t.dataset.source || "catalog");
    return;
  }

  if (t.hasAttribute("data-clear")) {
    clearCart();
    state.openLines.clear();
    renderSidebar();
    renderMain();
    renderSummaryLines();
    renderSummaryTotals();
    scheduleQuote();
    return;
  }

  if (t.dataset.licPage) {
    state.lic.page += t.dataset.licPage === "next" ? 1 : -1;
    state.lic.page = Math.max(1, state.lic.page);
    renderLicenseResults();
    return;
  }

  if (t.hasAttribute("data-set-api")) {
    const next = window.prompt("URL de l'API du calculateur :", apiBase);
    if (next && next.trim()) {
      localStorage.setItem("calculatorApiBase", next.trim());
      window.location.reload();
    }
    return;
  }

  if (t.hasAttribute("data-retry")) {
    loadAll();
    return;
  }
}

function addProduct(sku, source) {
  const meta = source === "license" ? state.lic.all.find((l) => l.sku === sku) : state.catalog.find((p) => p.sku === sku);
  if (!meta) return;

  // Quantité saisie dans la ligne produit (catalogue) sinon valeur par défaut.
  const input = document.querySelector(`[data-qty-input="${CSS.escape(lineKey(sku, source))}"]`);
  const qty = input ? Number(input.value) : source === "license" ? 1 : meta.baseQty || 1;
  upsertLine(meta, qty || meta.minQty || 1);
  if (source === "catalog") resizeSupportAfterEdit(sku);
  announce(`${meta.name} ajouté au devis`); // [A4]
  afterCartChange(source);
}

// [G3] Mémorise l'identité du stepper (boutons −/+ ou champ quantité) qui a le focus,
// pour le restaurer après un re-render destructif (innerHTML). Le même SKU pouvant
// apparaître dans la liste ET dans le résumé, on retient aussi la région.
function captureStepperFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset) return null;
  const region = el.closest("#summary-lines, #lic-results, #main-body");
  const regionId = region ? region.id : "";
  if (el.dataset.step) {
    return { kind: "step", dir: el.dataset.step, sku: el.dataset.sku, source: el.dataset.source, region: regionId };
  }
  if (el.hasAttribute("data-qty-edit")) {
    return { kind: "qty", sku: el.dataset.sku, source: el.dataset.source, start: el.selectionStart, end: el.selectionEnd, region: regionId };
  }
  return null;
}

// [G3] Restaure le focus capturé par captureStepperFocus() sur l'élément équivalent
// du DOM reconstruit. No-op si la ligne a disparu (ex. décrément sous minQty).
function restoreStepperFocus(tok) {
  if (!tok || !tok.sku) return;
  const scope = (tok.region && document.getElementById(tok.region)) || document;
  const sk = CSS.escape(tok.sku);
  const sel =
    tok.kind === "step"
      ? `[data-step="${tok.dir}"][data-sku="${sk}"][data-source="${tok.source}"]`
      : `[data-qty-edit][data-sku="${sk}"][data-source="${tok.source}"]`;
  const el = scope.querySelector(sel);
  if (!el) return;
  el.focus();
  if (tok.kind === "qty" && tok.start != null && el.setSelectionRange) {
    try {
      el.setSelectionRange(tok.start, tok.end);
    } catch {
      /* certains navigateurs interdisent setSelectionRange sur type=number */
    }
  }
}

// Met à jour l'affichage après une modification du panier sans casser le focus de la recherche licences.
function afterCartChange(source) {
  const focus = captureStepperFocus(); // [G3] avant les re-renders destructifs
  // Source licence : re-rendu léger des résultats licences (préserve le focus du champ #lic-q).
  // Sinon : re-rendu de la colonne centrale (la carte passe en mode « au panier »).
  if (source === "license") {
    renderLicenseResults();
  } else {
    renderMain();
  }
  renderSidebar();
  renderQuoteControls();
  renderSummaryLines();
  renderSummaryTotals();
  restoreStepperFocus(focus); // [G3] après reconstruction du DOM
  scheduleQuote();
}

// Exporte le devis courant (xlsx | pdf | html) : POST du panier puis téléchargement du fichier renvoyé.
async function exportQuote(format, btn) {
  if (!state.cart.length) return;
  const label = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.dataset.busy = "1";
    btn.textContent = "…";
  }
  try {
    const body = {
      lines: state.cart.map((l) => ({ sku: l.sku, quantity: l.quantity, source: l.source })),
      period_months: state.period,
      partner: state.partner,
      discount_percent: state.partner ? state.discount : 0,
      project: state.projectName || "",
      date: new Date().toLocaleDateString("fr-FR"),
    };
    const res = await fetch(buildUrl("api/quote/export", { format }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `devis-cloud-temple.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (btn) btn.innerHTML = label;
  } catch {
    if (btn) {
      btn.textContent = "Erreur";
      window.setTimeout(() => (btn.innerHTML = label), 1600);
    }
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = state.cart.length === 0;
    }
  }
}

function onInput(e) {
  const el = e.target;

  if (el.dataset.estField) {
    onEstimateInput(el);
    return;
  }

  if (el.id === "q-global") {
    state.search = el.value;
    // Recherche unifiée : un seul champ pilote le catalogue ET les licences.
    state.lic.query = el.value;
    state.lic.page = 1;
    // Le champ vit dans la toolbar statique (#main-body seul est re-rendu) → focus préservé.
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      renderMain();
      renderSidebar();
    }, 130);
    return;
  }

  if (el.id === "lic-q") {
    state.lic.query = el.value;
    state.lic.page = 1;
    window.clearTimeout(licTimer);
    licTimer = window.setTimeout(renderLicenseResults, 130);
    return;
  }

  if (el.id === "project") {
    state.projectName = el.value;
    persistQuotes();
    renderQuoteControls();
    return;
  }
}

function onChange(e) {
  const el = e.target;

  if (el.dataset.estOpt) {
    state.est[el.dataset.estOpt] = el.checked;
    persistEstimate();
    renderEstimateLive();
    return;
  }

  if (el.id === "lic-vendor") {
    state.lic.vendor = el.value;
    state.lic.page = 1;
    renderLicenseResults();
    return;
  }
  if (el.id === "lic-term") {
    state.lic.term = el.value;
    state.lic.page = 1;
    renderLicenseResults();
    return;
  }

  if (el.dataset.qtyEdit) {
    const { sku, source } = el.dataset;
    const line = findLine(sku, source);
    if (!line) return;
    let v = Math.round(Number(el.value));
    if (!Number.isFinite(v) || v < (line.minQty || 1)) v = line.minQty || 1;
    line.quantity = v;
    persistCart();
    resizeSupportAfterEdit(sku);
    afterCartChange(source);
    return;
  }
}

/* ---------- Estimation guidée (« Estimer mon projet ») ----------
   Le visiteur décrit ses serveurs ; on compare trois façons de les héberger
   (VM mutualisées, lames OpenIaaS, lames VMware) avec les prix publics du
   catalogue, puis il ajoute l'option choisie au devis. Calcul : sizing.js.
   Seuls le résumé et les propositions sont re-rendus pendant la saisie, pour
   ne jamais faire perdre le focus d'un champ. */
const Sizing = window.CalculatorSizing;
const ESTIMATE_KEY = "calc.estimate"; // ancienne estimation unique, migrée vers les cotations

function sanitizeServer(s) {
  const int = (v, lo, hi, d) => clamp(Math.round(Number(v)) || d, lo, hi);
  return {
    name: String(s?.name || "Serveur").slice(0, 60),
    size: Sizing.SIZES.some((z) => z.id === s?.size) ? s.size : "custom",
    vcpu: int(s?.vcpu, 1, 256, 2),
    ram: int(s?.ram, 1, 2048, 4),
    disk: int(s?.disk, 10, 65536, 50),
    qty: int(s?.qty, 1, 500, 1),
    custom: !!s?.custom,
  };
}

function defaultEstimate(usageId = "business-app") {
  const usage = Sizing.usageById(usageId);
  return {
    usage: usage.id,
    servers: Sizing.serversForUsage(usage.id).map(sanitizeServer),
    ha: false,
    backup: true,
    vmClass: usage.vmClass || "gp",
  };
}

function sanitizeEstimate(raw) {
  if (!raw || !Array.isArray(raw.servers)) return defaultEstimate();
  return {
    usage: String(raw.usage || "custom"),
    servers: raw.servers.slice(0, 50).map(sanitizeServer),
    ha: !!raw.ha,
    backup: raw.backup !== false,
    vmClass: Sizing.VM_CLASSES.some((c) => c.id === raw.vmClass) ? raw.vmClass : "gp",
  };
}

// L'estimation est celle de la cotation active (créée par défaut au premier accès).
Object.defineProperty(state, "est", {
  get: () => {
    const q = activeQuote();
    if (!q.est) q.est = defaultEstimate();
    return q.est;
  },
  set: (v) => {
    activeQuote().est = v;
  },
});

// Nettoyage des estimations relues du stockage, et migration de l'ancienne
// estimation unique (calc.estimate) vers la cotation active, une seule fois.
state.quotes.forEach((q) => {
  if (q.est) q.est = sanitizeEstimate(q.est);
});
try {
  const legacy = JSON.parse(localStorage.getItem(ESTIMATE_KEY) || "null");
  if (legacy && !activeQuote().est) activeQuote().est = sanitizeEstimate(legacy);
  persistQuotes(); // enregistrée dans la cotation AVANT de supprimer l'ancienne clé
  if (legacy) localStorage.removeItem(ESTIMATE_KEY);
} catch {
  /* stockage indisponible ou corrompu : estimation par défaut */
}

function persistEstimate() {
  persistQuotes();
}
state.estDetail = new Set(); // propositions dont le détail est déplié
state.estPrev = null; // prix par offre au dernier affichage (calcul des écarts)
state.estDeltas = {}; // écarts de prix affichés par offre
state.estFlip = false; // alterne deux animations identiques pour rejouer le flash
state.estChosen = null; // dernier devis créé depuis l'estimation (bandeau de confirmation)

// Changement de projet (cotation) : écarts, détails dépliés et bandeau repartent de zéro.
function resetEstimateUi() {
  state.estPrev = null;
  state.estDeltas = {};
  state.estChosen = null;
  state.estDetail.clear();
}

const estimateInput = () => ({
  servers: state.est.servers,
  ha: state.est.ha,
  backup: state.est.backup,
  vmClass: state.est.vmClass,
});

const plural = (n, one, many) => `${num(n)} ${n > 1 ? many : one}`;

function usageGridHtml() {
  return Sizing.USAGES.map((u) => {
    const on = state.est.usage === u.id;
    return `
      <button type="button" class="usage ${on ? "is-active" : ""}" data-est-usage="${u.id}" aria-pressed="${on}">
        <span class="usage__label">${esc(u.label)}</span>
        <span class="usage__hint">${esc(u.hint)}</span>
      </button>`;
  }).join("");
}

const serversRecap = (t) =>
  t.vms ? `${plural(t.vms, "serveur", "serveurs")} · ${num(t.vcpu)} vCPU · ${num(t.ram)} Go de RAM · ${num(t.disk)} Go de disque` : "";

const requirementsRecap = () =>
  [state.est.ha ? "Haute disponibilité" : "Sans haute disponibilité", state.est.backup ? "Sauvegarde" : "Sans sauvegarde"].join(" · ");

// Écran de résultat : le prix d'abord (barre collante), les offres, puis le
// panneau « Ajuster ». Les pastilles rouvrent l'assistant sur l'étape concernée.
function renderEstimateView(body) {
  const chip = (step, id, text) =>
    `<button type="button" class="est-chip" data-guide-open="${step}" data-from-result ${id ? `id="${id}"` : ""}><span>${esc(text)}</span>${I.edit}</button>`;
  body.innerHTML = `
    <div class="est">
      <div class="est__bar" id="est-bar">
        <h1 class="est__title" id="est-title" tabindex="-1">Votre estimation : à partir de <b id="est-best">—</b> <span class="est__per">HT / mois</span></h1>
        <span class="est__delta" id="est-best-delta" hidden></span>
      </div>
      <div class="est__chips">
        ${chip(1, "", Sizing.usageById(state.est.usage).label)}
        ${chip(2, "est-chip-servers", "")}
        ${chip(3, "est-chip-reqs", "")}
        <button type="button" class="linkish est__guide" data-guide-open="1">Me guider pas à pas</button>
      </div>
      <div id="est-done">${estDoneHtml()}</div>

      <section class="est__results" aria-labelledby="est-s4">
        <h2 class="est__h" id="est-s4">Nos propositions <span class="est__h-note">prix publics HT, recalculés à chaque modification</span></h2>
        <div class="offer-grid" id="est-offers"></div>
        ${estHypothesesHtml()}
      </section>

      <section class="est__step" aria-labelledby="est-adj">
        <h2 class="est__h" id="est-adj">Ajuster votre projet</h2>
        <div class="srv-list" id="est-servers">${estServersHtml()}</div>
        <div class="est__row">
          <button type="button" class="btn btn--ghost btn--sm" data-est-add>${I.plus} Ajouter un serveur</button>
          <span class="est__totals" id="est-totals"></span>
        </div>
        <div class="opt-list est__opts">
          ${optSwitch("ha", "Haute disponibilité", "Vos services restent en ligne si un serveur tombe en panne : capacité de secours et deux zones de disponibilité.")}
          ${optSwitch("backup", "Sauvegarde quotidienne", "Copie de vos serveurs et de leurs données, incluse dans le prix des serveurs dédiés. Pour les VM mutualisées, nos équipes la chiffrent avec vous.")}
        </div>
      </section>
    </div>`;
  state.estDeltas = {}; // pas de badge hérité d'une visite précédente de la vue
  renderEstimateLive();
}

function optSwitch(key, label, hint) {
  const on = !!state.est[key];
  return `
    <label class="opt">
      <input type="checkbox" class="opt__input" data-est-opt="${key}" ${on ? "checked" : ""} />
      <span class="opt__switch" aria-hidden="true"></span>
      <span class="opt__text"><span class="opt__label">${esc(label)}</span><span class="opt__hint">${esc(hint)}</span></span>
    </label>`;
}

function serverSpecs(s) {
  return `${num(s.vcpu)} vCPU · ${num(s.ram)} Go de RAM · ${num(s.disk)} Go de disque`;
}

function estServersHtml() {
  if (!state.est.servers.length) {
    return `<div class="srv-empty">Aucun serveur pour l'instant : ajoutez-en un.</div>`;
  }
  return state.est.servers
    .map((s, i) => {
      const sizes = Sizing.SIZES.map((z) => {
        const on = s.size === z.id;
        return `<button type="button" class="${on ? "is-active" : ""}" data-est-size="${z.id}" data-idx="${i}" aria-pressed="${on}" title="${esc(`${z.hint} : ${z.vcpu} vCPU, ${z.ram} Go de RAM, ${z.disk} Go de disque`)}">${esc(z.label)}</button>`;
      }).join("");
      const field = (key, label, min, max) => `
        <label class="srv__field">
          <span>${esc(label)}</span>
          <input class="input" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${s[key]}" data-est-field="${key}" data-idx="${i}" />
        </label>`;
      return `
        <div class="srv">
          <div class="srv__main">
            <input class="input srv__name" value="${esc(s.name)}" maxlength="60" data-est-field="name" data-idx="${i}" aria-label="Nom du serveur ${i + 1}" />
            <div class="segmented srv__sizes" role="group" aria-label="Taille du serveur ${esc(s.name)}">${sizes}</div>
            <div class="srv__qty" role="group" aria-label="Nombre de serveurs identiques">
              <button type="button" data-est-qty="-1" data-idx="${i}" aria-label="Un serveur de moins">−</button>
              <input type="number" min="1" max="500" step="1" value="${s.qty}" data-est-field="qty" data-idx="${i}" aria-label="Nombre de serveurs ${esc(s.name)}" />
              <button type="button" data-est-qty="1" data-idx="${i}" aria-label="Un serveur de plus">+</button>
            </div>
            <button type="button" class="btn btn--danger-ghost btn--icon" data-est-remove="${i}" title="Retirer ce serveur" aria-label="Retirer ${esc(s.name)}">${I.trash}</button>
          </div>
          <div class="srv__specs">
            <span id="est-spec-${i}">${serverSpecs(s)}</span>
            <button type="button" class="linkish" data-est-custom="${i}" aria-expanded="${s.custom}">${s.custom ? "Masquer le détail" : "Personnaliser"}</button>
          </div>
          ${
            s.custom
              ? `<div class="srv__custom">${field("vcpu", "vCPU", 1, 256)}${field("ram", "RAM (Go)", 1, 2048)}${field("disk", "Disque (Go)", 10, 65536)}</div>`
              : ""
          }
        </div>`;
    })
    .join("");
}

function estHypothesesHtml() {
  const z = Sizing.SIZING;
  return `
    <details class="est__hyp">
      <summary>Comment nous calculons</summary>
      <ul>
        <li><b>VM mutualisées (VM Instances)</b> : prix public par vCPU et par Go de RAM selon la classe choisie. Disque système inclus jusqu'à ${num(z.vmiIncludedDiskGb)} Go par serveur, le reste facturé au Go.</li>
        <li><b>Serveurs dédiés</b> : nous rangeons vos serveurs sur le modèle de lame le moins cher, chaque serveur tenant entier sur une lame, avec ${num(z.vcpuPerThread)} vCPU par thread physique et ${num(z.ramUsableRatio * 100)} % de la mémoire utilisable.</li>
        <li><b>Haute disponibilité</b> : deux zones de disponibilité ; chaque VM mutualisée est doublée dans la seconde zone, et les serveurs dédiés reçoivent une lame de secours (deux lames au minimum).</li>
        <li><b>Socle</b>, payé une fois pour tout votre environnement : activation du tenant, zone de disponibilité et support Standard (${num(z.supportRate * 100)} % des ressources, ${money(z.supportMinimum, true)} minimum).</li>
        <li>Estimation indicative en prix publics hors taxes, à confirmer avec nos équipes.</li>
      </ul>
    </details>`;
}

// Re-rendu léger : totaux, pastilles et propositions (les champs de saisie
// restent en place). Les écarts de prix ne sont calculés que lorsque les offres
// sont affichées : une modification faite dans l'assistant apparaît donc en
// écart au retour sur le résultat.
let announceTimer = null;
function renderEstimateLive() {
  const results = Sizing.estimateAll(estimateInput(), state.catalog);
  const t = results[0].totals;
  const recap = serversRecap(t);
  const totalsEl = document.querySelector("#est-totals");
  if (totalsEl) totalsEl.textContent = recap;
  const guideRecap = document.querySelector("#guide-recap");
  if (guideRecap) guideRecap.textContent = recap || "Aucun serveur";
  const next = document.querySelector("[data-guide-next]");
  if (next && state.guide.step === 2) next.disabled = !t.vms;

  const offersEl = document.querySelector("#est-offers");
  if (!offersEl) return;
  const chipServers = document.querySelector("#est-chip-servers span");
  if (chipServers) chipServers.textContent = recap || "Aucun serveur";
  const chipReqs = document.querySelector("#est-chip-reqs span");
  if (chipReqs) chipReqs.textContent = requirementsRecap();

  const current = Guide.monthlyByOffer(results);
  const deltas = Guide.priceDeltas(state.estPrev, current);
  const changed = Object.keys(deltas).length > 0;
  const prevBest = state.estPrev ? Math.min(...Object.values(state.estPrev)) : Infinity;
  if (changed) {
    state.estDeltas = deltas;
    state.estFlip = !state.estFlip;
  }
  state.estPrev = current;

  const priced = results.filter((r) => r.ok && !r.missing.length);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.monthly < a.monthly ? b : a)) : null;
  offersEl.innerHTML = results.map((r) => offerCardHtml(r, cheapest, changed)).join("");

  const best = document.querySelector("#est-best");
  if (best) best.textContent = cheapest ? money(cheapest.monthly) : "—";
  const bestDelta = document.querySelector("#est-best-delta");
  const bar = document.querySelector("#est-bar");
  if (changed && bestDelta && cheapest && Number.isFinite(prevBest)) {
    const d = Math.round((cheapest.monthly - prevBest) * 100) / 100;
    bestDelta.hidden = d === 0;
    bestDelta.className = `est__delta ${d > 0 ? "is-up" : "is-down"}`;
    bestDelta.textContent = `${d > 0 ? "+" : "−"}${money(Math.abs(d))} / mois`;
  }
  if (changed && bar) {
    bar.classList.remove("is-flash-a", "is-flash-b");
    bar.classList.add(state.estFlip ? "is-flash-a" : "is-flash-b");
  }
  // Lecteurs d'écran : une annonce par série de modifications, pas à chaque chiffre tapé.
  if (changed && cheapest) {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => announce(`Nouvelle estimation : à partir de ${money(cheapest.monthly)} hors taxes par mois`), 900);
  }
}

// Statut SecNumCloud lu dans le catalogue, sur le produit serveur retenu (lame
// ou vCPU VM Instances) : jamais déduit du nom de l'offre.
function offerQualification(r) {
  const main = r.ok ? r.lines.find((l) => l.group === "servers") : null;
  const item = main ? state.catalog.find((p) => p.sku === main.sku) : null;
  return item ? item.snc : "";
}

function offerCardHtml(r, cheapest, changed) {
  const o = r.offer;
  const isBest = !!cheapest && cheapest.offer.id === o.id;
  const snc = offerQualification(r);
  const qualified = snc === "yes";
  const badges = [
    isBest ? `<span class="offer__tag offer__tag--best">Le plus économique</span>` : "",
    qualified ? `<span class="offer__tag offer__tag--sens">Pour les données sensibles</span>` : "",
  ].join("");
  const qual = qualified
    ? `<span class="chip chip--snc">Qualifié SecNumCloud</span>`
    : snc === "pending"
      ? `<span class="chip chip--pending">SecNumCloud en cours</span>`
      : "";

  // Emplacements fixes, dans le même ordre pour toutes les cartes : la grille
  // (subgrid) aligne ainsi prix, détail et boutons d'une carte à l'autre.
  let body;
  if (!r.ok) {
    body = `<div class="offer__slot"><p class="offer__msg">${
      r.reason === "too_big"
        ? "Un de vos serveurs dépasse la capacité d'une lame. Nos équipes peuvent vous proposer une configuration adaptée."
        : "Ajoutez au moins un serveur pour voir le prix."
    }</p></div>${'<div class="offer__slot"></div>'.repeat(4)}`;
  } else if (r.missing.length) {
    body = `<div class="offer__slot"><p class="offer__msg">Tarif momentanément indisponible : le catalogue n'a pas pu être chargé.</p></div>${'<div class="offer__slot"></div>'.repeat(4)}`;
  } else {
    const open = state.estDetail.has(o.id);
    const chosen = !!state.estChosen && state.estChosen.offerId === o.id && state.estChosen.sig === estimateSig();
    const d = state.estDeltas[o.id];
    const flash = changed && d ? (state.estFlip ? "is-flash-a" : "is-flash-b") : "";
    const delta = d
      ? `<span class="offer__delta ${d > 0 ? "is-up" : "is-down"}">${d > 0 ? "+" : "−"}${money(Math.abs(d))} / mois</span>`
      : "";
    const what =
      o.id === "vmi"
        ? `<div class="segmented offer__class" role="group" aria-label="Classe de VM">${Sizing.VM_CLASSES.map(
            (c) =>
              `<button type="button" class="${state.est.vmClass === c.id ? "is-active" : ""}" data-est-class="${c.id}" aria-pressed="${state.est.vmClass === c.id}" title="${esc(c.hint)}">${esc(c.label)}</button>`
          ).join("")}</div>
          <p class="offer__what">${esc((Sizing.VM_CLASSES.find((c) => c.id === state.est.vmClass) || Sizing.VM_CLASSES[1]).hint)}</p>`
        : `<p class="offer__what">${plural(r.blade.count, "lame dédiée", "lames dédiées")} ${esc(r.blade.item.name)}</p>`;
    const rows = r.lines
      .map(
        (l) => `
        <div class="offer__line">
          <span>${esc(l.label)}</span>
          <span class="offer__qty">${num(l.quantity)} ${esc(l.unit)}</span>
          <span class="offer__amt">${money(l.total)}</span>
        </div>`
      )
      .join("");
    body = `
      <div class="offer__slot offer__pricebox">
        <div class="offer__price ${flash}"><b>${money(r.monthly)}</b><span>HT / mois</span></div>
        ${delta}
      </div>
      <div class="offer__slot offer__split">
        <span>Serveurs <b>${money(r.serversMonthly)}</b></span>
        <span title="Payé une fois pour tout votre environnement">Socle <b>${money(r.baseMonthly)}</b></span>
      </div>
      <div class="offer__slot">${what}</div>
      <div class="offer__slot">
        <button type="button" class="btn offer__cta ${isBest ? "offer__cta--best" : ""} ${chosen ? "is-done" : ""}" data-est-choose="${o.id}" ${chosen ? 'aria-disabled="true"' : ""}>${
          chosen ? `${I.check} Offre retenue` : "Choisir cette offre"
        }</button>
      </div>
      <div class="offer__slot">
        <button type="button" class="linkish offer__toggle" data-est-detail="${o.id}" aria-expanded="${open}">${I.chevron} ${open ? "Masquer le détail" : "Voir le détail"}</button>
        ${open ? `<div class="offer__lines">${rows}</div>` : ""}
      </div>`;
  }

  return `
    <article class="offer ${isBest ? "is-best" : ""}">
      <div class="offer__slot offer__tags">${badges}</div>
      <h3 class="offer__slot offer__title">${esc(o.label)}</h3>
      <div class="offer__slot offer__sub"><span>${esc(o.product)}</span>${qual}</div>
      <p class="offer__slot offer__hint">${esc(o.hint)}</p>
      ${body}
    </article>`;
}

// Empreinte de la saisie : un second clic sur la même offre, sans rien changer,
// ne crée pas un devis en double.
const estimateSig = () => JSON.stringify(estimateInput());

// « Choisir cette offre » : une cotation = un projet, donc l'offre REMPLACE le
// contenu de la cotation active. Garde : si ce contenu a été modifié à la main
// depuis le dernier choix (ou rempli depuis le catalogue), on demande confirmation.
async function chooseOffer(offerId) {
  const r = Sizing.estimateOffer(offerId, estimateInput(), state.catalog);
  if (!r.ok || r.missing.length) return;
  const sig = estimateSig();
  if (state.estChosen && state.estChosen.offerId === offerId && state.estChosen.sig === sig) return;

  const q = activeQuote();
  const idx = state.quotes.findIndex((x) => x.id === q.id);
  if (Guide.replaceGuard(q.cart, q.chosenSig) === "confirm") {
    const ok = await confirmDialog({
      title: "Remplacer le contenu du devis ?",
      body: `Attention : le devis « ${quoteLabel(q, idx)} » contient ${plural(q.cart.length, "ligne", "lignes")}, avec des produits ou des quantités modifiés à la main. Choisir l'offre « ${r.offer.label} » les supprimera toutes et les remplacera par les lignes de cette offre. Cette action ne peut pas être annulée.`,
      ok: "Remplacer le devis",
    });
    if (!ok || activeQuote() !== q) return;
  }

  state.cart = [];
  state.openLines.clear();
  r.lines.forEach((l) => {
    const meta = state.catalog.find((p) => p.sku === l.sku);
    if (meta) upsertLine(meta, l.quantity);
  });
  resizeSupportLine();
  if (!state.projectName.trim()) {
    state.projectName = Guide.uniqueName(
      Sizing.usageById(state.est.usage).label,
      state.quotes.filter((x) => x.id !== q.id).map((x, i) => quoteLabel(x, i))
    );
  }
  q.chosenSig = Guide.cartSignature(state.cart);
  persistQuotes();
  state.estChosen = { offerId, sig, name: quoteLabel(q, idx), label: r.offer.label, monthly: r.monthly };
  announce(`Devis « ${state.estChosen.name} » : offre ${r.offer.label}, ${money(r.monthly)} hors taxes par mois`);
  afterCartChange("catalog");
  document.querySelector("#est-done .est-done")?.focus();
}

/* Fenêtre de confirmation (garde avant une action destructrice). Promesse résolue
   à true (confirmer) ou false (annuler, Échap, clic sur le fond). Le focus va sur
   « Annuler » par défaut et revient ensuite à l'élément d'origine. */
let confirmResolve = null;
let confirmReturnFocus = null;
function confirmDialog({ title, body, ok }) {
  const m = document.querySelector("#confirm-modal");
  if (!m) return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  if (confirmResolve) closeConfirm(false);
  m.querySelector("#confirm-title").textContent = title;
  m.querySelector("#confirm-body").textContent = body;
  m.querySelector('[data-confirm="ok"]').textContent = ok;
  confirmReturnFocus = document.activeElement;
  m.classList.add("is-open");
  document.body.classList.add("modal-open");
  m.querySelector('[data-confirm="cancel"].btn')?.focus();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}
function isConfirmOpen() {
  return !!confirmResolve;
}
function closeConfirm(result) {
  const m = document.querySelector("#confirm-modal");
  if (m) m.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(result);
  if (!result) confirmReturnFocus?.focus?.();
  confirmReturnFocus = null;
}

function estDoneHtml() {
  const c = state.estChosen;
  if (!c) return "";
  return `
    <div class="est-done" tabindex="-1">
      <span class="est-done__ico" aria-hidden="true">${I.check}</span>
      <div class="est-done__text">
        <b>Devis « ${esc(c.name)} » prêt</b> avec l'offre ${esc(c.label)}, ${esc(money(c.monthly))} HT / mois. Il s'affiche dans le panneau Devis.
        <span class="est-done__hint">Choisir une autre offre remplacera ce contenu. Pour chiffrer un autre projet, créez une nouvelle cotation.</span>
      </div>
      <button type="button" class="btn btn--ghost btn--sm" data-summary-toggle>Voir le devis</button>
      <button type="button" class="modal__close" data-est-done-close aria-label="Masquer ce message">${I.close}</button>
    </div>`;
}

// Support Standard = 5 % des ressources de TOUT le devis (500 € minimum) : après
// un ajout, on le recalcule sur l'ensemble des lignes catalogue hors socle, pour
// qu'additionner deux estimations donne le même support qu'une estimation unique.
function resizeSupportLine() {
  const k = Sizing.SIZING.skus;
  const support = findLine(k.support, "catalog");
  const supportItem = state.catalog.find((p) => p.sku === k.support);
  if (!support || !supportItem) return;
  const base = new Set([k.tenant, k.az, k.support]);
  const resources = state.cart
    .filter((l) => l.source === "catalog" && !base.has(l.sku))
    .reduce((sum, l) => sum + (state.catalog.find((p) => p.sku === l.sku)?.publicPrice || 0) * l.quantity, 0);
  upsertLine(supportItem, Sizing.supportPackages(resources, supportItem));
}

// Après une modification manuelle du panier : le support suit les ressources,
// sauf si c'est la ligne de support elle-même que le visiteur vient de régler.
function resizeSupportAfterEdit(editedSku) {
  if (editedSku !== Sizing.SIZING.skus.support) resizeSupportLine();
}

// Re-rendu de la liste des serveurs, en redonnant le focus à l'élément équivalent.
function rerenderServers(focusSelector) {
  const list = document.querySelector("#est-servers");
  if (list) list.innerHTML = estServersHtml();
  persistEstimate();
  renderEstimateLive();
  if (focusSelector) document.querySelector(focusSelector)?.focus();
}

// Clics de l'estimateur. Renvoie true si l'événement a été traité.
function onEstimateClick(t) {
  const idx = Number(t.dataset.idx);
  const s = Number.isInteger(idx) ? state.est.servers[idx] : null;

  if (t.dataset.estUsage) {
    state.est = { ...defaultEstimate(t.dataset.estUsage), ha: state.est.ha, backup: state.est.backup };
    persistEstimate();
    if (state.guide.open) renderGuide(`[data-est-usage="${t.dataset.estUsage}"]`);
    else renderMain();
    document.querySelector(`[data-est-usage="${t.dataset.estUsage}"]`)?.focus();
    return true;
  }
  if (t.dataset.estSize && s) {
    const z = Sizing.SIZES.find((x) => x.id === t.dataset.estSize);
    Object.assign(s, { size: z.id, vcpu: z.vcpu, ram: z.ram, disk: z.disk });
    rerenderServers(`[data-est-size="${z.id}"][data-idx="${idx}"]`);
    return true;
  }
  if (t.dataset.estQty && s) {
    s.qty = clamp(s.qty + Number(t.dataset.estQty), 1, 500);
    rerenderServers(`[data-est-qty="${t.dataset.estQty}"][data-idx="${idx}"]`);
    return true;
  }
  if (t.dataset.estCustom) {
    const srv = state.est.servers[Number(t.dataset.estCustom)];
    if (srv) srv.custom = !srv.custom;
    rerenderServers(`[data-est-custom="${t.dataset.estCustom}"]`);
    return true;
  }
  if (t.dataset.estRemove) {
    state.est.servers.splice(Number(t.dataset.estRemove), 1);
    state.est.usage = "custom";
    rerenderServers("[data-est-add]");
    return true;
  }
  if (t.hasAttribute("data-est-add")) {
    const n = state.est.servers.length + 1;
    state.est.servers.push(sanitizeServer(Sizing.serverFromSize("M", { name: `Serveur ${n}` })));
    rerenderServers(`[data-est-field="name"][data-idx="${n - 1}"]`);
    return true;
  }
  if (t.dataset.estClass) {
    state.est.vmClass = t.dataset.estClass;
    persistEstimate();
    renderEstimateLive();
    document.querySelector(`[data-est-class="${t.dataset.estClass}"]`)?.focus();
    return true;
  }
  if (t.dataset.estDetail) {
    const id = t.dataset.estDetail;
    if (state.estDetail.has(id)) state.estDetail.delete(id);
    else state.estDetail.add(id);
    renderEstimateLive();
    document.querySelector(`[data-est-detail="${id}"]`)?.focus();
    return true;
  }
  if (t.dataset.estChoose) {
    chooseOffer(t.dataset.estChoose);
    return true;
  }
  if (t.hasAttribute("data-est-done-close")) {
    state.estChosen = null;
    const done = document.querySelector("#est-done");
    if (done) done.innerHTML = "";
    renderEstimateLive();
    document.querySelector("#est-title")?.focus();
    return true;
  }
  return false;
}

// Saisie dans un champ de l'estimateur (nom, quantité, vCPU, RAM, disque).
function onEstimateInput(el) {
  const s = state.est.servers[Number(el.dataset.idx)];
  if (!s) return;
  const key = el.dataset.estField;
  if (key === "name") {
    s.name = el.value.slice(0, 60);
    persistEstimate();
    return;
  }
  if (el.value === "") return; // champ en cours d'effacement : on attend une valeur
  const next = sanitizeServer({ ...s, [key]: el.value });
  s[key] = next[key];
  if (key !== "qty") s.size = "custom";
  const spec = document.querySelector(`#est-spec-${Number(el.dataset.idx)}`);
  if (spec) spec.textContent = serverSpecs(s);
  document.querySelectorAll(`[data-est-size][data-idx="${Number(el.dataset.idx)}"]`).forEach((b) => {
    b.classList.toggle("is-active", b.dataset.estSize === s.size);
    b.setAttribute("aria-pressed", String(b.dataset.estSize === s.size));
  });
  persistEstimate();
  renderEstimateLive();
}

/* ---------- Parcours guidé : assistant de première visite, modes guidé / libre ----------
   Règles (transitions, préférences, choix du devis) : guide.js, module pur testé.
   Ici, seulement le rendu et le câblage. L'assistant plein écran recouvre l'app
   (rendue inerte) ; il porte les champs de l'estimation pendant qu'il est ouvert. */
const Guide = window.CalculatorGuide;
const FREE_FAMILY = "compute"; // vue d'arrivée du devis libre
const GUIDE_STEPS = ["Votre projet", "Vos serveurs", "Vos exigences", "Estimation"];
const guidePrefs = Guide.readPrefs(localStorage);
state.mode = guidePrefs.mode;
state.guide = Guide.initialGuide(guidePrefs);
if (guidePrefs.onboarded && guidePrefs.mode === "free") state.activeFamily = FREE_FAMILY;
let revealTimer = null;

function setMode(mode) {
  state.mode = mode === "free" ? "free" : "guided";
  Guide.savePrefs(localStorage, { mode: state.mode });
}

// Bascule guidé / libre : quitte la recherche et ouvre la vue d'arrivée du mode.
function goMode(mode) {
  setMode(mode);
  state.activeFamily = state.mode === "guided" ? "estimate" : FREE_FAMILY;
  state.subfamily = "";
  state.openCards.clear();
  if (state.search) {
    state.search = "";
    state.lic.query = "";
    state.lic.page = 1;
    const input = document.querySelector("#q-global");
    if (input) input.value = "";
  }
  renderSidebar();
  renderMain();
}

function renderModeSwitch() {
  const guided = !state.search.trim() && state.activeFamily === "estimate";
  document.querySelectorAll("[data-mode]").forEach((b) => {
    const on = (b.dataset.mode === "guided") === guided;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function applyGuide(action) {
  const prev = state.guide;
  const next = Guide.reduceGuide(prev, action);
  if (next === prev) return;
  state.guide = next;
  window.clearTimeout(revealTimer);

  if (prev.open && !next.open) {
    Guide.savePrefs(localStorage, { onboarded: true });
    renderGuide();
    goMode(action.type === "pickFree" ? "free" : "guided");
    document.querySelector(action.type === "pickFree" ? "#q-global" : "#est-title")?.focus();
    return;
  }
  if (!prev.open) renderMain(); // la vue d'estimation cède ses champs à l'assistant
  renderGuide();
  if (next.step === Guide.REVEAL) {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    revealTimer = window.setTimeout(() => applyGuide({ type: "revealDone" }), reduced ? 400 : 1200);
  }
}

function guideStepsHtml(g) {
  if (g.step === Guide.ENTRY) return "";
  const items = GUIDE_STEPS.map((label, i) => {
    const n = i + 1;
    const done = n < g.step;
    const current = n === g.step;
    const reachable = done && n <= Guide.LAST_STEP && g.step <= Guide.LAST_STEP;
    return `
      <li class="gsteps__item ${done ? "is-done" : ""} ${current ? "is-current" : ""}">
        <button type="button" class="gsteps__node" ${reachable ? `data-guide-goto="${n}"` : "disabled"} ${current ? 'aria-current="step"' : ""}>
          <span class="gsteps__num" aria-hidden="true">${done ? I.check : n}</span>
          <span class="gsteps__label">${esc(label)}</span>
        </button>
      </li>`;
  }).join("");
  return `<ol class="gsteps" aria-label="Étapes de l'estimation">${items}</ol>`;
}

function guideBodyHtml(g) {
  const title = (text) => `<h1 class="guide__title" id="guide-title" tabindex="-1" data-guide-focus>${esc(text)}</h1>`;
  const eyebrow = `<p class="guide__eyebrow">Étape ${g.step} sur ${Guide.LAST_STEP}</p>`;
  const nextLabel = g.fromResult ? "Mettre à jour l'estimation" : g.step === Guide.LAST_STEP ? "Voir mon estimation" : "Continuer";
  const foot = `
    <div class="guide__foot">
      <button type="button" class="btn btn--ghost" data-guide-back>← Retour</button>
      <button type="button" class="btn btn--primary" data-guide-next>${esc(nextLabel)}</button>
    </div>`;

  if (g.step === Guide.ENTRY) {
    return `
      <div class="guide__card">
        ${title("Comment voulez-vous construire votre devis ?")}
        <p class="guide__lede">Vous pourrez changer de mode à tout moment, en haut de la page.</p>
        <div class="guide__modes">
          <button type="button" class="usage guide__mode" data-guide-mode="guided">
            <span class="usage__label">Devis guidé</span>
            <span class="usage__hint">Décrivez votre projet en 3 étapes : nous comparons pour vous les offres adaptées. Idéal si vous découvrez nos produits.</span>
          </button>
          <button type="button" class="usage guide__mode" data-guide-mode="free">
            <span class="usage__label">Devis libre</span>
            <span class="usage__hint">Choisissez directement les produits dans le catalogue. Idéal si vous savez ce qu'il vous faut.</span>
          </button>
        </div>
      </div>`;
  }
  if (g.step === 1) {
    return `
      <div class="guide__card">
        ${eyebrow}${title("Quel est votre projet ?")}
        <p class="guide__lede">Choisissez le cas le plus proche : nous préremplissons vos serveurs, vous les ajusterez à l'étape suivante.</p>
        <div class="usage-grid" role="group" aria-label="Type de projet">${usageGridHtml()}</div>
        ${foot}
      </div>`;
  }
  if (g.step === 2) {
    return `
      <div class="guide__card guide__card--wide">
        ${eyebrow}${title("De quels serveurs avez-vous besoin ?")}
        <p class="guide__lede">Une taille par serveur et le nombre d'exemplaires identiques. Pas sûr ? « Moyen » convient à la plupart des applications.</p>
        <div class="srv-list" id="est-servers">${estServersHtml()}</div>
        <div class="est__row">
          <button type="button" class="btn btn--ghost btn--sm" data-est-add>${I.plus} Ajouter un serveur</button>
          <span class="est__totals" id="est-totals"></span>
        </div>
        ${foot}
      </div>`;
  }
  if (g.step === 3) {
    return `
      <div class="guide__card">
        ${eyebrow}${title("Quelles sont vos exigences ?")}
        <p class="guide__lede">Ces options changent le prix. Vous pourrez les modifier sur l'écran de résultat.</p>
        <div class="opt-list guide__opts">
          ${optSwitch("ha", "Haute disponibilité", "Vos services restent en ligne si un serveur tombe en panne : capacité de secours et deux zones de disponibilité.")}
          ${optSwitch("backup", "Sauvegarde quotidienne", "Copie de vos serveurs et de leurs données. Pour les VM mutualisées, nos équipes la chiffrent avec vous.")}
        </div>
        ${foot}
      </div>`;
  }
  return `
    <div class="guide__reveal" role="status">
      <div class="spinner" aria-hidden="true"></div>
      ${title("Nous comparons 3 façons d'héberger votre projet")}
      <p class="guide__lede" id="guide-recap"></p>
    </div>`;
}

function renderGuide(focusSelector) {
  const root = document.querySelector("#guide");
  const shell = document.querySelector(".shell");
  if (!root) return;
  const g = state.guide;
  if (!g.open) {
    root.hidden = true;
    root.innerHTML = "";
    if (shell) shell.inert = false;
    document.body.classList.remove("guide-open");
    return;
  }
  root.hidden = false;
  if (shell) shell.inert = true; // clavier et lecteurs d'écran restent dans l'assistant
  document.body.classList.add("guide-open");
  const skipLabel = g.fromResult || g.revealed ? "Fermer" : "Passer l'assistant";
  root.innerHTML = `
    <div class="guide__top">
      <div class="brand">
        <div class="brand__mark">${I.brand}</div>
        <div class="brand__text">
          <span class="brand__eyebrow">Cloud Temple</span>
          <span class="brand__title">Calculateur d'offre Cloud</span>
        </div>
      </div>
      ${g.step === Guide.REVEAL ? "" : `<button type="button" class="linkish guide__skip" data-guide-skip>${esc(skipLabel)}</button>`}
    </div>
    ${guideStepsHtml(g)}
    <div class="guide__stage">${guideBodyHtml(g)}</div>`;
  renderEstimateLive(); // totaux de l'étape 2, récapitulatif de la révélation
  root.querySelector(focusSelector || "[data-guide-focus]")?.focus();
}

// Clics de l'assistant et du sélecteur de mode. Renvoie true si l'événement a été traité.
function onGuideClick(t) {
  // TEMPORAIRE (recette) : rejoue la première visite complète. À retirer avant la mise en ligne.
  if (t.hasAttribute("data-guide-replay")) {
    window.clearTimeout(revealTimer);
    state.guide = Guide.initialGuide({ onboarded: false, mode: state.mode });
    renderMain();
    renderGuide();
    return true;
  }
  if (t.dataset.mode) {
    goMode(t.dataset.mode);
    return true;
  }
  if (t.dataset.guideMode) {
    applyGuide({ type: t.dataset.guideMode === "free" ? "pickFree" : "pickGuided" });
    return true;
  }
  if (t.hasAttribute("data-guide-next")) {
    applyGuide({ type: "next" });
    return true;
  }
  if (t.hasAttribute("data-guide-back")) {
    applyGuide({ type: "back" });
    return true;
  }
  if (t.hasAttribute("data-guide-skip")) {
    applyGuide({ type: "skip" });
    return true;
  }
  if (t.dataset.guideGoto) {
    applyGuide({ type: "goto", step: Number(t.dataset.guideGoto) });
    return true;
  }
  if (t.dataset.guideOpen) {
    applyGuide({ type: "open", step: Number(t.dataset.guideOpen), fromResult: t.hasAttribute("data-from-result") });
    return true;
  }
  return false;
}

/* ---------- Boot ---------- */
mount();
render();
renderGuide();
loadAppVersion();
loadAll();
