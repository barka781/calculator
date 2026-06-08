/* Cloud Temple Calculator — calculette à plat.
   Familles dépliables, panier + résumé financier temps réel via /api/quote.
   Le backend applique : prix_remisé = public × (1 − standard%) × (1 − commerciale%). */

const LOCAL_FALLBACK = "http://127.0.0.1:8001";
// URL de l'API : window > localStorage > backend local. Mutable : voir le repli
// automatique dans fetchJson (une URL mémorisée invalide ne bloque plus le front).
let apiBase =
  window.CALCULATOR_API_BASE ||
  localStorage.getItem("calculatorApiBase") ||
  LOCAL_FALLBACK;

const PAGE_SIZE = 50;
const PERIODS = [1, 12, 24, 36, 48, 60];

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
const SUMMARY_DEFAULT = 600;
const SUMMARY_PRESETS = [
  { px: 420, label: "S", title: "Compact" },
  { px: 600, label: "M", title: "Standard" },
  { px: 820, label: "L", title: "Large" },
];

/* ---------- Familles & groupes (mappés sur le champ `category` du backend) ---------- */
const GROUPS = [
  { id: "infra", label: "Infrastructure — IaaS" },
  { id: "platform", label: "Plateforme — PaaS & IA" },
  { id: "data", label: "Données & continuité" },
  { id: "security", label: "Sécurité" },
  { id: "services", label: "Services & infogérance" },
  { id: "licenses", label: "Licences éditeurs" },
];

const FAMILIES = [
  { id: "compute", label: "Compute", group: "infra", icon: "compute", categories: ["Compute"], tag: "VMware, OpenIaaS, bare metal" },
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
};
const familyIcon = (f) => I[f.icon] || I.services;

/* ---------- État ---------- */
const quoteBoot = loadQuoteState();
const state = {
  health: null,
  online: false,
  apiError: "",
  loading: true,
  dataSource: "live", // "live" | "cache" | "embedded"
  dataStale: false, // true quand on sert un repli (API injoignable)
  dataSavedAt: "", // horodatage de la donnée de repli affichée
  catalog: [],
  catalogByFamily: new Map(),
  search: "",
  expanded: new Set(),
  lic: { all: [], loaded: false, loading: false, error: "", query: "", vendor: "", term: "", page: 1 },
  quotes: quoteBoot.quotes,
  activeQuoteId: quoteBoot.activeQuoteId,
  syncing: false,
  syncResult: null,
  syncError: "",
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
  const map = { monthly: "Mensuel", yearly: "Annuel", annual: "Annuel", one_shot: "Ponctuel", oneshot: "Ponctuel" };
  return map[String(t || "").toLowerCase()] || (t ? String(t) : "");
};

/* ---------- Données ---------- */

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
  renderStatus();

  let catalogOk = false;
  try {
    state.health = await fetchJson("health", { timeout: 6000 });
    state.online = state.health?.status === "ok";
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
    snc: !!meta.snc,
    tags: tagsFor(item, specs),
  };
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
    publicPrice,
    discountPct: pct,
    discountedPrice: publicPrice * (1 - pct / 100),
    search: `${item.sku} ${item.name} ${item.vendor} ${item.edition} ${item.description || ""}`.toLowerCase(),
  };
}

/* ---------- Panier ---------- */
const lineKey = (sku, source) => `${source}:${sku}`;
const findLine = (sku, source) => state.cart.find((l) => l.sku === sku && l.source === source);

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
  state.cart = state.cart.filter((l) => !(l.sku === sku && l.source === source));
  persistCart();
}

function clearCart() {
  state.cart = [];
  state.quote = null;
  state.quoteLoading = false;
  state.quoteError = "";
  state.quoteSource = "live";
  persistCart();
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
      discount_percent: state.discount,
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
    }
  }
}

const quoteLineFor = (sku, source) =>
  state.quote?.lines?.find((l) => l.sku === sku && l.source === source);

/* ---------- Rendu : prix ---------- */
function priceBlock(publicPrice, discounted, pct, unit) {
  const hasDiscount = pct > 0 && discounted < publicPrice - 0.0001;
  return `
    <div class="product__price">
      ${hasDiscount ? `<div class="price__public">${esc(money(publicPrice))}</div>` : ""}
      <div class="price__disc">${esc(money(discounted))}</div>
      <div class="price__unit">/ ${esc(unit)}${hasDiscount ? ` · −${num(pct)}%` : ""}</div>
    </div>`;
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
          <div class="field-inline">
            <label for="project">Nom de la cotation</label>
            <input id="project" class="input input--project" placeholder="Nommer cette cotation" title="Renomme l'onglet actif" value="${esc(state.projectName)}" />
          </div>
          <span id="api-status"></span>
          <button class="btn btn--ghost btn--sm" data-set-api title="Configurer l'URL de l'API">${I.gear} API</button>
        </div>
      </header>

      <nav class="quote-tabs" id="quote-tabs" aria-label="Cotations"></nav>

      <div id="banner-slot"></div>

      <div class="layout">
        <section class="catalog">
          <div class="catalog__head">
            <h1 class="catalog__title">Composez votre offre</h1>
            <p class="catalog__subtitle">Dépliez une famille, ajoutez des produits, le budget se calcule en temps réel.</p>
          </div>
          <div class="catalog-toolbar">
            <div class="search-box">
              ${I.search}
              <input id="q-global" class="input" placeholder="Rechercher un produit (nom, SKU, type…)" value="${esc(state.search)}" />
            </div>
            <button class="btn btn--ghost" data-toggle-all>Tout déplier</button>
          </div>
          <div id="catalog-groups"></div>
        </section>

        <aside id="summary-slot">${summarySkeleton()}</aside>
      </div>

      <footer class="sitefoot">
        <div id="sync-foot" class="sync"></div>
      </footer>
    </div>`;
  renderQuoteControls();
  wireEvents();
  wireResizer();
  applySummaryWidth(readSummaryWidth(), false); // restaure la largeur mémorisée
}

function quoteTabsHtml() {
  const tabs = state.quotes
    .map((q, i) => {
      const active = q.id === state.activeQuoteId;
      const label = quoteLabel(q, i);
      const lineCount = q.cart.length;
      return `
        <button class="quote-tab ${active ? "is-active" : ""}" data-quote-switch="${esc(q.id)}" title="${esc(label)}">
          <span class="quote-tab__label">${esc(label)}</span>
          <span class="quote-tab__count">${num(lineCount)}</span>
          ${
            state.quotes.length > 1
              ? `<span class="quote-tab__close" data-quote-close="${esc(q.id)}" title="Fermer la cotation">${I.close}</span>`
              : ""
          }
        </button>`;
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

  const period = document.querySelector("#period-select");
  if (period) period.value = String(state.period);

  const discNum = document.querySelector("#discount-num");
  if (discNum && Number(discNum.value) !== state.discount) discNum.value = String(state.discount);

  const discRange = document.querySelector("#discount-range");
  if (discRange) discRange.value = String(clamp(state.discount, 0, 60));

  const discVal = document.querySelector("#discount-val");
  if (discVal) discVal.textContent = `${num(state.discount)} %`;
}

function summarySkeleton() {
  const periodOpts = PERIODS.map(
    (p) => `<option value="${p}" ${p === state.period ? "selected" : ""}>${p === 1 ? "1 mois" : p % 12 === 0 ? `${p / 12} an${p / 12 > 1 ? "s" : ""}` : `${p} mois`}</option>`
  ).join("");
  const sizeBtns = SUMMARY_PRESETS.map(
    (p) => `<button class="size-btn" type="button" data-summary-size="${p.px}" title="${esc(p.title)} (${p.px}px)" aria-label="Largeur ${esc(p.title)}">${esc(p.label)}</button>`
  ).join("");
  return `
    <div class="summary">
      <div class="summary__resizer" title="Glisser pour redimensionner · double-clic pour réinitialiser" role="separator" aria-label="Redimensionner le panneau"></div>
      <div class="summary__head">
        <h2>Résumé financier</h2>
        <span class="summary__badge" id="count-badge">0 ligne</span>
        <div class="summary__sizes" role="group" aria-label="Largeur du panneau">${sizeBtns}</div>
        <button class="btn btn--danger-ghost btn--sm" data-clear hidden id="clear-btn">Vider</button>
      </div>
      <div class="summary__config">
        <div class="cfg">
          <label for="period-select">Projection</label>
          <select id="period-select" class="input">${periodOpts}</select>
        </div>
        <div class="cfg">
          <label for="discount-num">Remise commerciale</label>
          <input id="discount-num" class="input" type="number" min="0" max="100" step="1" value="${state.discount}" />
        </div>
        <div class="cfg cfg--discount">
          <div class="discount-row">
            <input id="discount-range" type="range" min="0" max="60" step="1" value="${clamp(state.discount, 0, 60)}" />
            <span class="discount-val" id="discount-val">${num(state.discount)} %</span>
          </div>
        </div>
      </div>
      <div class="summary__lines" id="summary-lines"></div>
      <div class="summary__totals" id="summary-totals"></div>
      <div class="summary__export" id="summary-export">
        <button class="export-btn" data-export="xlsx" title="Télécharger en Excel">${I.download} Excel</button>
        <button class="export-btn" data-export="pdf" title="Télécharger en PDF">${I.download} PDF</button>
        <button class="export-btn" data-export="html" title="Télécharger en HTML (imprimable)">${I.download} HTML</button>
      </div>
      <div class="summary__foot">Tarifs HT en euros · remise standard catalogue appliquée automatiquement</div>
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

/* ---------- Rendu : statut + bandeau ---------- */
function renderStatus() {
  const el = document.querySelector("#api-status");
  if (!el) return;
  if (state.online) {
    const h = state.health || {};
    el.outerHTML = `<span id="api-status" class="status-pill is-online"><span class="dot"></span>En ligne · ${num(h.catalog_items)} produits · ${num(h.license_items)} licences</span>`;
  } else if (state.dataStale && state.catalog.length) {
    el.outerHTML = `<span id="api-status" class="status-pill is-local" title="API injoignable — catalogue servi depuis une source locale"><span class="dot"></span>Hors ligne · données locales</span>`;
  } else {
    el.outerHTML = `<span id="api-status" class="status-pill is-offline"><span class="dot"></span>Hors ligne</span>`;
  }
}

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

/* ---------- Rendu : fraîcheur de la source (pied de page) ----------
   Alimenté par /health (bloc `sync`) : source live/locale, commit + date,
   dernière synchro. Le statut « stale » remonte d'un refresh dégradé
   (source distante injoignable mais cache conservé). */
function renderSyncFoot() {
  const el = document.querySelector("#sync-foot");
  if (!el) return;

  // Hors-ligne : on expose la source de repli (cache/snapshot) et sa fraîcheur.
  if (state.dataStale || !state.online) {
    if (state.catalog.length) {
      const srcLabel =
        state.dataSource === "cache" ? "Cache navigateur (dernière visite)" : "Snapshot embarqué (livré avec l'app)";
      const when = state.dataSavedAt ? ` · ${esc(fmtDate(state.dataSavedAt))}` : "";
      el.innerHTML = `
        <div class="sync__info">
          <span class="sync__badge is-stale"><span class="dot"></span>Hors-ligne</span>
          <span class="sync__src">${esc(srcLabel)}</span>
          <span class="sync__meta">données locales${when}</span>
        </div>
        <button class="btn btn--ghost btn--sm" data-retry>Réessayer</button>`;
    } else {
      el.innerHTML = `<span class="sync__src">Source de données indisponible</span>`;
    }
    return;
  }

  const sync = state.health?.sync || null;
  if (!sync) {
    el.innerHTML = `<span class="sync__src">Source de données indisponible</span>`;
    return;
  }

  const src = sync.source || {};
  const git = src.git || {};
  const isLive = src.kind === "live_git";
  const srcLabel = isLive ? "QuoteFlow — flux live (dépôt git maîtrisé)" : "QuoteFlow — copie locale";
  const repo = git.url || git.remote || "";

  const staleRefresh = state.syncResult?.refresh?.status === "stale";
  let badgeCls = "is-fresh";
  let badgeLabel = "À jour";
  if (staleRefresh) {
    badgeCls = "is-stale";
    badgeLabel = "Source distante injoignable · cache conservé";
  } else if (!sync.is_synchronized) {
    badgeCls = "is-warn";
    badgeLabel = "Mise à jour disponible";
  }

  const parts = [];
  if (git.commit) parts.push(`commit <code>${esc(git.commit)}</code>`);
  if (git.commit_date) parts.push(esc(fmtDate(git.commit_date)));
  const lastSyncAt = sync.last_sync?.synced_at;
  parts.push(lastSyncAt ? `synchronisé le ${esc(fmtDate(lastSyncAt))}` : "jamais synchronisé");

  const err = state.syncError ? `<span class="sync__err">${esc(state.syncError)}</span>` : "";

  el.innerHTML = `
    <div class="sync__info">
      <span class="sync__badge ${badgeCls}"><span class="dot"></span>${esc(badgeLabel)}</span>
      <span class="sync__src">${esc(srcLabel)}</span>
      <span class="sync__meta">${parts.join(" · ")}${repo ? ` · <span class="sync__repo">${esc(repo)}</span>` : ""}</span>
      ${err}
    </div>
    <button class="btn btn--ghost btn--sm" data-sync ${state.syncing ? "disabled" : ""}>${
      state.syncing ? "Synchronisation…" : "Synchroniser"
    }</button>`;
}

/* ---------- Rendu : catalogue ---------- */
function matchProduct(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.sku} ${p.description} ${p.category} ${p.type} ${p.subType} ${p.tags.join(" ")}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}

function visibleProducts(familyId) {
  const list = state.catalogByFamily.get(familyId) || [];
  const q = state.search.trim().toLowerCase();
  return q ? list.filter((p) => matchProduct(p, q)) : list;
}

function renderCatalog() {
  const root = document.querySelector("#catalog-groups");
  if (!root) return;

  if (state.loading) {
    root.innerHTML = `<div class="loading-block"><div class="spinner"></div>Chargement du catalogue…</div>`;
    return;
  }
  // On affiche dès qu'un catalogue existe, quelle que soit sa source (live, cache
  // navigateur ou snapshot embarqué) → plus jamais d'écran vide quand l'API est down.
  if (!state.catalog.length) {
    root.innerHTML = `<div class="loading-block">${
      state.online ? "Aucun produit dans le catalogue." : "Catalogue indisponible : API hors ligne et aucune donnée locale."
    }</div>`;
    return;
  }

  const q = state.search.trim().toLowerCase();

  // En recherche, on charge les licences une seule fois pour qu'elles participent aux résultats.
  if (q && !state.lic.loaded && !state.lic.loading) {
    loadLicenses().then(() => {
      if (state.search.trim()) renderCatalog();
    });
  }

  let html = "";

  GROUPS.forEach((group) => {
    const fams = FAMILIES.filter((f) => f.group === group.id);
    const cards = fams
      .map((f) => familyCard(f, q))
      .filter(Boolean)
      .join("");
    if (!cards) return;
    html += `<div class="group"><div class="group__label">${esc(group.label)}</div>${cards}</div>`;
  });

  // Bandeau récapitulatif des résultats de recherche.
  if (q) {
    let prodMatches = 0;
    let famMatches = 0;
    FAMILIES.forEach((f) => {
      if (f.kind === "licenses") return;
      const m = (state.catalogByFamily.get(f.id) || []).filter((p) => matchProduct(p, q)).length;
      if (m) {
        prodMatches += m;
        famMatches += 1;
      }
    });
    const licMatches = state.lic.loaded ? filteredLicenses().length : null;
    const parts = [];
    if (prodMatches) parts.push(`<strong>${num(prodMatches)}</strong> produit${prodMatches > 1 ? "s" : ""} dans ${num(famMatches)} famille${famMatches > 1 ? "s" : ""}`);
    if (licMatches === null) parts.push(`recherche des licences…`);
    else if (licMatches) parts.push(`<strong>${num(licMatches)}</strong> licence${licMatches > 1 ? "s" : ""}`);
    const summaryText = parts.length ? parts.join(" · ") : "Aucun résultat";
    html =
      `<div class="search-summary">
        <span class="search-summary__txt">${summaryText} pour « ${esc(state.search.trim())} »</span>
        <button class="search-summary__clear" data-clear-search>Effacer</button>
      </div>` + html;
  }

  root.innerHTML = html || `<div class="loading-block">Aucun résultat pour « ${esc(state.search)} ».</div>`;

  if (state.expanded.has("licenses") || q) renderLicenseResults();
}

function familyCard(f, q) {
  if (f.kind === "licenses") {
    const total = state.health?.license_items || (state.lic.loaded ? state.lic.all.length : 0);
    const searching = !!q;
    let countLabel = total ? num(total) : "—";
    if (searching) {
      if (state.lic.loaded) {
        const n = filteredLicenses().length;
        if (!n) return ""; // aucune licence ne correspond → on masque la carte en recherche
        countLabel = `<em>${num(n)}</em> / ${total ? num(total) : "—"}`;
      } else {
        countLabel = "…"; // licences en cours de chargement, comptage à venir
      }
    }
    // En recherche, la famille s'ouvre d'office (la recherche globale pilote son filtre via state.lic.query).
    const open = state.expanded.has(f.id) || searching;
    return `
      <div class="family ${open ? "is-open" : ""}" data-family="${f.id}">
        <button class="family__head" data-family-toggle="${f.id}">
          <span class="family__icon">${familyIcon(f)}</span>
          <span class="family__meta">
            <span class="family__name">${esc(f.label)}</span>
            <span class="family__tag">${esc(f.tag)}</span>
          </span>
          <span class="family__count">${countLabel}</span>
          <span class="family__chevron">${I.chevron}</span>
        </button>
        ${open ? `<div class="family__body">${licensePanelShell()}</div>` : ""}
      </div>`;
  }

  const all = state.catalogByFamily.get(f.id) || [];
  if (!all.length) return "";
  const items = q ? all.filter((p) => matchProduct(p, q)) : all;
  if (q && !items.length) return "";

  const open = state.expanded.has(f.id) || (q && items.length > 0);
  const countLabel = q ? `<em>${items.length}</em> / ${all.length}` : num(all.length);

  return `
    <div class="family ${open ? "is-open" : ""}" data-family="${f.id}">
      <button class="family__head" data-family-toggle="${f.id}">
        <span class="family__icon">${familyIcon(f)}</span>
        <span class="family__meta">
          <span class="family__name">${esc(f.label)}</span>
          <span class="family__tag">${esc(f.tag)}</span>
        </span>
        <span class="family__count">${countLabel}</span>
        <span class="family__chevron">${I.chevron}</span>
      </button>
      ${open ? `<div class="family__body">${items.map(productRow).join("")}</div>` : ""}
    </div>`;
}

function productRow(p) {
  const line = findLine(p.sku, p.source);
  const tags = [
    `<span class="chip chip--sku">${highlight(p.sku, state.search)}</span>`,
    p.snc ? `<span class="chip chip--snc">SecNumCloud</span>` : "",
    p.engagement && engagementMonths(p.engagement) > 1 ? `<span class="chip chip--eng">${esc(p.engagement)}</span>` : "",
    ...p.tags.map((t) => `<span class="chip">${highlight(t, state.search)}</span>`),
  ]
    .filter(Boolean)
    .join("");

  const action = line
    ? stepper(p.sku, p.source, line.quantity)
    : `<div class="add-control">
         <input class="qty-input" type="number" min="${p.minQty}" step="1" value="${p.baseQty}" data-qty-input="${esc(lineKey(p.sku, p.source))}" aria-label="Quantité" />
         <button class="btn btn--primary btn--sm" data-add="${esc(p.sku)}">Ajouter</button>
       </div>`;

  return `
    <div class="product ${line ? "is-in-cart" : ""}">
      <div class="product__main">
        <div class="product__name">${highlight(p.name, state.search)}</div>
        ${p.description ? `<div class="product__desc">${highlight(p.description, state.search)}</div>` : ""}
        <div class="product__tags">${tags}</div>
      </div>
      ${priceBlock(p.publicPrice, p.discountedPrice, p.discountPct, p.unit)}
      <div class="product__action">${action}</div>
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
  const hasDisc = l.discountPct > 0;
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

  if (badge) badge.textContent = `${state.cart.length} ligne${state.cart.length > 1 ? "s" : ""}`;
  if (clearBtn) clearBtn.hidden = state.cart.length === 0;
  document.querySelectorAll("#summary-export .export-btn").forEach((b) => {
    if (!b.dataset.busy) {
      b.dataset.defaultTitle ||= b.title;
      b.disabled = state.cart.length === 0 || state.quoteSource === "local";
      b.title = state.quoteSource === "local" ? "Export indisponible hors-ligne" : b.dataset.defaultTitle;
    }
  });

  if (!state.cart.length) {
    root.innerHTML = `
      <div class="summary__empty">
        ${I.cart}
        <div>Votre devis est vide.<br />Dépliez une famille et ajoutez des produits.</div>
      </div>`;
    return;
  }

  root.innerHTML = state.cart
    .map((l) => {
      const ql = quoteLineFor(l.sku, l.source);
      const unit = ql?.unit || l.unit || "unité";
      const unitPrice = ql ? ql.discounted_unit_price : null;
      const monthly = ql ? ql.monthly_total : null;
      const publicMonthly = ql ? ql.public_unit_price * ql.quantity : null;
      const showPub = publicMonthly !== null && monthly !== null && publicMonthly > monthly + 0.001;
      const sub = unitPrice !== null ? `${num(l.quantity)} × ${money(unitPrice)} / ${esc(unit)}` : `${num(l.quantity)} × ${esc(unit)}`;
      // Détail des remises et de l'engagement appliqués à la ligne (issus de l'API).
      const meta = [];
      if (ql && ql.standard_discount_percent > 0) meta.push(`<span class="cl-chip cl-chip--std">−${num(ql.standard_discount_percent)}% catalogue</span>`);
      if (state.discount > 0) meta.push(`<span class="cl-chip cl-chip--com">−${num(state.discount)}% commerciale</span>`);
      if (ql && ql.engagement_months > 1) meta.push(`<span class="cl-chip cl-chip--eng">engagement ${num(ql.engagement_months)} mois</span>`);
      const engTot = ql && ql.engagement_total ? ql.engagement_total : null;
      // Détail exhaustif par ligne (tous les champs fournis par l'API).
      let details = "";
      if (ql) {
        const pub = ql.public_unit_price;
        const std = ql.standard_discount_percent || 0;
        const com = state.discount || 0;
        const afterStd = pub * (1 - std / 100);
        const monthlySaving = publicMonthly !== null && monthly !== null ? publicMonthly - monthly : 0;
        const row = (lbl, val, cls = "") =>
          `<div class="cld-row ${cls}"><span class="cld-lbl">${esc(lbl)}</span><span class="cld-val">${val}</span></div>`;
        const rows = [];
        rows.push(row("Prix public unitaire", `${esc(money(pub))} <small>/ ${esc(unit)}</small>`));
        if (std > 0) {
          rows.push(row("Remise catalogue", `<span class="cld-neg">−${num(std)} %</span>`));
          rows.push(row("Après remise catalogue", `${esc(money(afterStd))} <small>/ ${esc(unit)}</small>`));
        }
        if (com > 0) rows.push(row("Remise commerciale", `<span class="cld-neg">−${num(com)} %</span>`));
        rows.push(row("PU remisé", `${esc(money(unitPrice))} <small>/ ${esc(unit)}</small>`, "cld-row--accent"));
        rows.push(row("Quantité", `× ${num(l.quantity)}`));
        if (publicMonthly !== null) rows.push(row("Mensuel public", esc(money(publicMonthly))));
        if (monthly !== null) rows.push(row("Mensuel remisé", `${esc(money(monthly))} <small>/mois</small>`, "cld-row--strong"));
        if (monthlySaving > 0.005) rows.push(row("Économie / mois", `<span class="cld-save">−${esc(money(monthlySaving))}</span>`));
        if (ql.engagement_months > 1) rows.push(row("Engagement", `${num(ql.engagement_months)} mois`));
        if (engTot !== null) rows.push(row("Total sur l'engagement", esc(money(engTot)), "cld-row--strong"));
        details = `<div class="cart-line__details">${rows.join("")}</div>`;
      }
      return `
        <div class="cart-line">
          <div>
            <div class="cart-line__name" title="${esc(l.name)}">${esc(ql?.name || l.name)}</div>
            <div class="cart-line__sub">${sub}</div>
            ${meta.length ? `<div class="cart-line__meta">${meta.join("")}</div>` : ""}
          </div>
          <div class="cart-line__total">
            ${showPub ? `<span class="pub">${esc(money(publicMonthly))}</span>` : ""}
            ${monthly !== null ? `${esc(money(monthly))}<span class="per">/mois</span>` : "…"}
            ${engTot !== null ? `<span class="eng-tot">${esc(money(engTot))} sur engagement</span>` : ""}
          </div>
          <div class="cart-line__ctrl">
            ${stepper(l.sku, l.source, l.quantity)}
            <button class="btn btn--danger-ghost btn--sm cart-line__remove" data-remove="${esc(l.sku)}" data-source="${l.source}">${I.trash} Retirer</button>
          </div>
          ${details}
        </div>`;
    })
    .join("");
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

  // Répartition des remises (mensuel) : part catalogue (standard) vs part commerciale.
  let stdSaving = 0;
  let afterStd = 0;
  q.lines.forEach((ql) => {
    const pubM = ql.public_unit_price * ql.quantity;
    const afterStdM = ql.public_unit_price * (1 - (ql.standard_discount_percent || 0) / 100) * ql.quantity;
    stdSaving += pubM - afterStdM;
    afterStd += afterStdM;
  });
  const comSaving = afterStd * ((q.discount_percent || 0) / 100);

  const breakdown = [];
  if (stdSaving > 0.005) breakdown.push(`<div class="total-row total-row--sub"><span class="lbl">↳ dont remise catalogue</span><span class="val">−${esc(money(stdSaving))}</span></div>`);
  if (comSaving > 0.005) breakdown.push(`<div class="total-row total-row--sub"><span class="lbl">↳ dont remise commerciale</span><span class="val">−${esc(money(comSaving))}</span></div>`);

  root.innerHTML = `
    ${byFamily.size > 1 ? `<div class="fam-block"><div class="fam-block__title">Répartition mensuelle</div>${famRows}</div>` : ""}
    <div class="total-row total-row--muted"><span class="lbl">Mensuel public</span><span class="val">${esc(money(q.monthly_public_total))}</span></div>
    ${breakdown.join("")}
    <div class="total-row total-row--main">
      <span class="lbl">Total mensuel remisé</span>
      <span class="val">${esc(money(q.monthly_discounted_total))}<span class="per per--main">/mois</span></span>
    </div>
    <div class="total-row"><span class="lbl">Projection ${esc(monthsLabel)}</span><span class="val">${esc(money(q.period_discounted_total))}</span></div>
    <div class="total-row"><span class="lbl">Total à l'engagement</span><span class="val">${esc(money(q.total_on_engagement))}</span></div>
    <div class="total-row total-row--save"><span class="lbl">Économie sur ${esc(monthsLabel)}</span><span class="val">${esc(money(q.savings_total))}</span></div>
    ${state.quoteSource === "local" ? `<div class="total-sub">Calcul local hors-ligne · export indisponible jusqu'au retour de l'API</div>` : ""}
    ${state.quoteLoading ? `<div class="total-sub">Mise à jour…</div>` : ""}`;
}

/* ---------- Rendu global ---------- */
function render() {
  renderQuoteControls();
  renderStatus();
  renderBanner();
  renderCatalog();
  renderSummaryLines();
  renderSummaryTotals();
  renderSyncFoot();
}

/* ---------- Événements ---------- */
function wireEvents() {
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onChange);
}

function onClick(e) {
  const t = e.target.closest("[data-family-toggle],[data-toggle-all],[data-add],[data-step],[data-remove],[data-clear],[data-clear-search],[data-export],[data-lic-page],[data-set-api],[data-retry],[data-sync],[data-quote-switch],[data-quote-new],[data-quote-duplicate],[data-quote-close],[data-summary-size]");
  if (!t) return;

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
    renderCatalog();
    return;
  }

  if (t.dataset.familyToggle) {
    const id = t.dataset.familyToggle;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else {
      state.expanded.add(id);
      if (id === "licenses") loadLicenses();
    }
    renderCatalog();
    return;
  }

  if (t.hasAttribute("data-toggle-all")) {
    const allIds = FAMILIES.filter((f) => f.kind === "licenses" || (state.catalogByFamily.get(f.id) || []).length).map((f) => f.id);
    const allOpen = allIds.every((id) => state.expanded.has(id));
    if (allOpen) {
      state.expanded.clear();
      t.textContent = "Tout déplier";
    } else {
      allIds.forEach((id) => state.expanded.add(id));
      if (state.expanded.has("licenses")) loadLicenses();
      t.textContent = "Tout replier";
    }
    renderCatalog();
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
    afterCartChange(source);
    return;
  }

  if (t.dataset.remove) {
    removeLine(t.dataset.remove, t.dataset.source || "catalog");
    afterCartChange(t.dataset.source || "catalog");
    return;
  }

  if (t.hasAttribute("data-clear")) {
    clearCart();
    renderCatalog();
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

  if (t.hasAttribute("data-sync")) {
    runSync();
  }
}

// Déclenche une synchronisation côté backend (refresh de la source live + copie),
// puis recharge la fraîcheur et le catalogue. Passe par fetchJson → bénéficie du
// repli automatique sur le backend local si l'URL configurée est injoignable.
async function runSync() {
  if (state.syncing) return;
  state.syncing = true;
  state.syncError = "";
  renderSyncFoot();
  try {
    state.syncResult = await fetchJson("api/sync/catalog", {
      method: "POST",
      params: { refresh: true },
      timeout: 60000,
    });
  } catch {
    state.syncError = "Synchronisation impossible";
  } finally {
    state.syncing = false;
  }
  await loadAll();
}

function addProduct(sku, source) {
  const meta = source === "license" ? state.lic.all.find((l) => l.sku === sku) : state.catalog.find((p) => p.sku === sku);
  if (!meta) return;

  // Quantité saisie dans la ligne produit (catalogue) sinon valeur par défaut.
  const input = document.querySelector(`[data-qty-input="${CSS.escape(lineKey(sku, source))}"]`);
  const qty = input ? Number(input.value) : source === "license" ? 1 : meta.baseQty || 1;
  upsertLine(meta, qty || meta.minQty || 1);
  afterCartChange(source);
}

// Met à jour l'affichage après une modification du panier sans casser le focus de la recherche licences.
function afterCartChange(source) {
  if (source === "license") {
    renderLicenseResults();
  } else {
    renderCatalog();
  }
  renderQuoteControls();
  renderSummaryLines();
  renderSummaryTotals();
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
      discount_percent: state.discount,
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

  if (el.id === "q-global") {
    state.search = el.value;
    // Recherche unifiée : un seul champ pilote le catalogue ET les licences.
    state.lic.query = el.value;
    state.lic.page = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderCatalog, 130);
    return;
  }

  if (el.id === "lic-q") {
    state.lic.query = el.value;
    state.lic.page = 1;
    window.clearTimeout(licTimer);
    licTimer = window.setTimeout(renderLicenseResults, 130);
    return;
  }

  if (el.id === "discount-range" || el.id === "discount-num") {
    let v = clamp(Number(el.value), 0, 100);
    state.discount = v;
    persistQuotes();
    const range = document.querySelector("#discount-range");
    const numInput = document.querySelector("#discount-num");
    const valEl = document.querySelector("#discount-val");
    if (range && el.id !== "discount-range") range.value = clamp(v, 0, 60);
    if (numInput && el.id !== "discount-num") numInput.value = v;
    if (valEl) valEl.textContent = `${num(v)} %`;
    scheduleQuote();
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

  if (el.id === "period-select") {
    state.period = Number(el.value) || 12;
    persistQuotes();
    scheduleQuote();
    renderQuoteControls();
    renderSummaryTotals();
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
    afterCartChange(source);
    return;
  }
}

/* ---------- Boot ---------- */
mount();
render();
loadAll();
