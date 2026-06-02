const API_BASE =
  window.CALCULATOR_API_BASE ||
  localStorage.getItem("calculatorApiBase") ||
  "http://127.0.0.1:8001";

const state = {
  activeFamily: "Tous",
  activeType: "Tous",
  apiError: "",
  apiOnline: false,
  cart: [],
  catalogTotal: 0,
  discount: 25,
  health: null,
  licenseTotal: 0,
  loading: true,
  period: 12,
  products: [],
  query: "",
  quote: null,
  quoteError: "",
  quoteLoading: false,
  syncError: "",
  syncing: false,
  syncStatus: null,
};

const app = document.querySelector("#app");
let quoteTimer = null;
let searchTimer = null;
let licenseSearchRequestId = 0;
let quoteRequestId = 0;

const familyOrder = [
  "Tous",
  "Compute",
  "Stockage",
  "Sauvegarde",
  "Réseau",
  "PaaS",
  "Services",
  "Licences",
];

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatMoney = (value, compact = false) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: compact ? 0 : 2,
  }).format(Number(value) || 0);

const formatNumber = (value) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(
    Number(value) || 0,
  );

const buildUrl = (path, params = {}) => {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  const url = new URL(path, base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

const fetchJson = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(buildUrl(path, options.params), {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
};

const getFamily = (item) => {
  const text = `${item.category || ""} ${item.type || ""} ${item.sub_type || ""}`.toLowerCase();
  if (text.includes("licence") || text.includes("license")) return "Licences";
  if (
    text.includes("compute") ||
    text.includes("vmware") ||
    text.includes("openiaas") ||
    text.includes("bare")
  ) {
    return "Compute";
  }
  if (text.includes("storage") || text.includes("stockage")) return "Stockage";
  if (text.includes("backup") || text.includes("sauvegarde")) return "Sauvegarde";
  if (
    text.includes("network") ||
    text.includes("firewall") ||
    text.includes("loadbalancer") ||
    text.includes("bastion") ||
    text.includes("vpc")
  ) {
    return "Réseau";
  }
  if (text.includes("paas") || text.includes("kubernetes") || text.includes("openshift")) {
    return "PaaS";
  }
  if (text.includes("service")) return "Services";
  return item.category || "Services";
};

const getDefaultQuantity = (unit, family) => {
  const normalized = String(unit || "").toLowerCase();
  if (normalized.includes("gio") || normalized.includes("go")) return 1024;
  if (normalized.includes("utilisateur")) return 10;
  if (normalized.includes("core")) return 8;
  if (family === "Sauvegarde") return 10;
  return 1;
};

const compactTags = (values) =>
  values
    .filter(Boolean)
    .map((value) => String(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 4);

const normalizeCatalogItem = (item) => {
  const family = getFamily(item);
  const summary = item.pricing_summary || {};
  const specs = item.specs || {};
  const metadata = item.metadata || {};
  const unit = summary.unit || item.unit || "unite";
  const price = Number(summary.public_price || item.pricing?.public_price || 0);

  return {
    sku: item.sku,
    name: item.name || item.title || item.sku,
    category: item.category || "Catalogue",
    family,
    type: item.type || family,
    subType: item.sub_type || "",
    unit,
    price,
    defaultQuantity: getDefaultQuantity(unit, family),
    minQuantity: Number(summary.min_quantity || 1),
    description: item.description || item.source_file || "",
    tags: compactTags([
      item.type,
      item.sub_type,
      metadata.snc ? "SNC" : "",
      specs.ram ? `${specs.ram} Go RAM` : "",
      specs.cores ? `${specs.cores} cores` : "",
      specs.iops_per_tb ? `${specs.iops_per_tb} IOPS/To` : "",
    ]),
    source: "catalog",
  };
};

const normalizeLicenseItem = (item) => ({
  sku: item.sku,
  name: item.name || item.sku,
  category: item.category || "Licence",
  family: "Licences",
  type: item.vendor || "Licence",
  subType: item.edition || "",
  unit: item.unit || "unite",
  price: Number(item.price || item.pricing?.public_price || 0),
  defaultQuantity: getDefaultQuantity(item.unit, "Licences"),
  minQuantity: 1,
  description: item.description || [item.vendor, item.edition].filter(Boolean).join(" · "),
  tags: compactTags([item.vendor, item.edition, item.pricing?.term]),
  source: "license",
});

const productKey = (item) => `${item.source || "auto"}:${item.sku}`;

const mergeProducts = (...groups) => {
  const byKey = new Map();
  groups.flat().forEach((item) => {
    if (item?.sku) byKey.set(productKey(item), item);
  });
  return Array.from(byKey.values()).sort((a, b) =>
    `${a.family}${a.type}${a.name}`.localeCompare(`${b.family}${b.type}${b.name}`, "fr"),
  );
};

const countBy = (items, getter) =>
  items.reduce((acc, item) => {
    const key = getter(item) || "Autres";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const getFamilies = () => {
  const counts = countBy(state.products, (item) => item.family);
  return familyOrder
    .filter((family) => family === "Tous" || counts[family])
    .map((family) => ({
      label: family,
      count: family === "Tous" ? state.products.length : counts[family],
    }));
};

const getTypes = () => {
  const scoped =
    state.activeFamily === "Tous"
      ? state.products
      : state.products.filter((item) => item.family === state.activeFamily);
  const counts = countBy(scoped, (item) => item.type);
  return [
    { label: "Tous", count: scoped.length },
    ...Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([label, count]) => ({ label, count })),
  ];
};

const matchesSearch = (item) => {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [item.name, item.sku, item.family, item.type, item.subType, item.description, ...item.tags]
    .join(" ")
    .toLowerCase()
    .includes(query);
};

const getVisibleProducts = () =>
  state.products.filter((item) => {
    const familyMatch =
      state.activeFamily === "Tous" || item.family === state.activeFamily;
    const typeMatch = state.activeType === "Tous" || item.type === state.activeType;
    return familyMatch && typeMatch && matchesSearch(item);
  });

const findProduct = (sku, preferredSource = "auto") => {
  if (preferredSource !== "auto") {
    const exact = state.products.find(
      (item) => item.sku === sku && item.source === preferredSource,
    );
    if (exact) return exact;
  }
  return state.products.find((item) => item.sku === sku);
};

const isInCart = (sku) => state.cart.some((line) => line.sku === sku);

const getCartRows = () =>
  state.cart
    .map((line) => {
      const product = findProduct(line.sku, line.source);
      const apiLine = state.quote?.lines?.find((item) => item.sku === line.sku);
      return product ? { ...product, ...line, apiLine } : null;
    })
    .filter(Boolean);

const getLineTotal = (line) =>
  line.apiLine?.monthly_total ??
  line.price * line.quantity * (1 - state.discount / 100);

const getTotals = () => {
  const rows = getCartRows();
  const monthly =
    state.quote?.monthly_discounted_total ??
    rows.reduce((sum, line) => sum + getLineTotal(line), 0);
  const publicMonthly =
    state.quote?.monthly_public_total ??
    rows.reduce((sum, line) => sum + line.price * line.quantity, 0);

  return {
    rows,
    monthly,
    publicMonthly,
    periodTotal: state.quote?.period_discounted_total ?? monthly * state.period,
    savings: state.quote?.savings_total ?? (publicMonthly - monthly) * state.period,
  };
};

const scheduleQuote = () => {
  window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(calculateRemoteQuote, 220);
};

const scheduleLicenseSearch = () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadRemoteLicensesForSearch, 260);
};

const setFamily = (family) => {
  state.activeFamily = family;
  state.activeType = "Tous";
  render();
  if (family === "Licences") scheduleLicenseSearch();
};

const setType = (type) => {
  state.activeType = type;
  render();
};

const setQuery = (query) => {
  state.query = query;
  render();
  scheduleLicenseSearch();
};

const setPeriod = (period) => {
  state.period = Number(period);
  state.quote = null;
  render();
  scheduleQuote();
};

const setDiscount = (discount) => {
  state.discount = Number(discount);
  state.quote = null;
  render();
  scheduleQuote();
};

const addToCart = (sku, source = "auto") => {
  const item = findProduct(sku, source);
  if (!item) return;
  const line = state.cart.find((cartLine) => cartLine.sku === sku);
  if (line) {
    line.quantity += item.defaultQuantity;
    if (line.source === "auto") line.source = source;
  } else {
    state.cart.push({ sku, quantity: item.defaultQuantity, source });
  }
  state.quote = null;
  render();
  scheduleQuote();
};

const removeFromCart = (sku) => {
  state.cart = state.cart.filter((line) => line.sku !== sku);
  state.quote = null;
  render();
  scheduleQuote();
};

const updateQuantity = (sku, quantity) => {
  const line = state.cart.find((cartLine) => cartLine.sku === sku);
  const product = findProduct(sku, line?.source || "auto");
  if (!line || !product) return;
  line.quantity = Math.max(product.minQuantity, Number(quantity) || product.minQuantity);
  state.quote = null;
  render();
  scheduleQuote();
};

const loadInitialData = async () => {
  state.loading = true;
  state.apiError = "";
  render();

  try {
    const [health, catalog] = await Promise.all([
      fetchJson("health"),
      fetchJson("api/catalog", { params: { limit: 1000 } }),
    ]);

    state.health = health;
    state.catalogTotal = catalog.total || catalog.items?.length || 0;
    state.licenseTotal = health.license_items || 0;
    state.apiOnline = true;
    state.syncStatus = health.sync || null;
    state.products = mergeProducts((catalog.items || []).map(normalizeCatalogItem));
  } catch (error) {
    state.apiOnline = false;
    state.apiError = `API indisponible sur ${API_BASE}`;
    state.products = [];
    state.catalogTotal = 0;
    state.licenseTotal = 0;
    state.quote = null;
  } finally {
    state.loading = false;
    render();
  }

  if (state.apiOnline) {
    loadSyncStatus();
  }
};

const loadSyncStatus = async () => {
  if (!state.apiOnline) return;
  try {
    state.syncError = "";
    state.syncStatus = await fetchJson("api/sync/status");
    render();
  } catch {
    state.syncError = "Statut de synchronisation indisponible";
    render();
  }
};

const runCatalogSync = async () => {
  if (!state.apiOnline || state.syncing) return;
  state.syncing = true;
  state.syncError = "";
  render();

  try {
    const result = await fetchJson("api/sync/catalog", { method: "POST" });
    state.syncStatus = result.after || null;
    await loadInitialData();
  } catch (error) {
    state.syncError = "Synchronisation impossible";
    render();
  } finally {
    state.syncing = false;
    render();
  }
};

const loadRemoteLicensesForSearch = async (force = false) => {
  if (!state.apiOnline) return;
  const query = state.query.trim();
  const shouldSearch =
    force ||
    state.activeFamily === "Licences" ||
    query.length >= 2 ||
    state.cart.some((line) => line.source === "license");
  if (!shouldSearch) return;

  const requestId = ++licenseSearchRequestId;
  try {
    const response = await fetchJson("api/licenses", {
      params: { q: query || undefined, limit: 200 },
    });
    if (requestId !== licenseSearchRequestId) return;
    state.licenseTotal = response.total || response.items?.length || 0;
    state.products = mergeProducts(
      state.products.filter((item) => item.source !== "license" || isInCart(item.sku)),
      (response.items || []).map(normalizeLicenseItem),
    );
    render();
  } catch {
    // Keep the catalog visible if license search fails.
  }
};

const calculateRemoteQuote = async () => {
  if (!state.apiOnline || state.cart.length === 0) {
    state.quote = null;
    state.quoteLoading = false;
    render();
    return;
  }

  const requestId = ++quoteRequestId;
  state.quoteLoading = true;
  state.quoteError = "";
  render();

  try {
    const quote = await fetchJson("api/quote", {
      method: "POST",
      body: JSON.stringify({
        period_months: state.period,
        discount_percent: state.discount,
        lines: state.cart.map((line) => ({
          sku: line.sku,
          quantity: line.quantity,
          source: line.source || "auto",
        })),
      }),
    });
    if (requestId !== quoteRequestId) return;
    state.quote = quote;
  } catch {
    if (requestId !== quoteRequestId) return;
    state.quote = null;
    state.quoteError = "Calcul API impossible";
  } finally {
    if (requestId === quoteRequestId) {
      state.quoteLoading = false;
      render();
    }
  }
};

const itemRow = (item) => {
  const selected = isInCart(item.sku);
  const tags = item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `
    <article class="catalog-row">
      <div class="catalog-row__main">
        <div class="catalog-row__title">
          <strong>${escapeHtml(item.name)}</strong>
          <code>${escapeHtml(item.sku)}</code>
        </div>
        <p>${escapeHtml(item.description || "Description non renseignee")}</p>
        <div class="tag-row">${tags}</div>
      </div>
      <div class="catalog-row__meta">
        <span>${escapeHtml(item.family)}</span>
        <span>${escapeHtml(item.type)}</span>
        ${item.subType ? `<span>${escapeHtml(item.subType)}</span>` : ""}
      </div>
      <div class="catalog-row__price">
        <strong>${formatMoney(item.price)}</strong>
        <span>/${escapeHtml(item.unit)}</span>
      </div>
      <button class="row-action ${selected ? "is-selected" : ""}" data-add="${escapeHtml(item.sku)}" data-source="${escapeHtml(item.source)}">
        ${selected ? "Ajoute" : "Ajouter"}
      </button>
    </article>
  `;
};

const cartLine = (line) => `
  <li class="cart-line">
    <div class="cart-line__main">
      <div>
        <strong>${escapeHtml(line.name)}</strong>
        <span>${escapeHtml(line.sku)}</span>
      </div>
      <button class="ghost-icon" data-remove="${escapeHtml(line.sku)}" aria-label="Retirer">×</button>
    </div>
    <div class="cart-line__controls">
      <label>
        <span>Quantité</span>
        <input type="number" min="${line.minQuantity}" value="${line.quantity}" data-quantity="${escapeHtml(line.sku)}" />
      </label>
      <div class="line-total">
        <span>${formatMoney(line.apiLine?.public_unit_price ?? line.price)} / ${escapeHtml(line.unit)}</span>
        <strong>${formatMoney(getLineTotal(line))}</strong>
      </div>
    </div>
  </li>
`;

const sidebarButton = (item, active, attr) => `
  <button class="${active ? "active" : ""}" ${attr}="${escapeHtml(item.label)}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${formatNumber(item.count)}</strong>
  </button>
`;

const render = () => {
  const activeElement = document.activeElement;
  const restoreSearch =
    activeElement && activeElement.matches && activeElement.matches(".search-box input");
  const searchSelection = restoreSearch ? activeElement.selectionStart : null;

  const visibleProducts = getVisibleProducts();
  const totals = getTotals();
  const families = getFamilies();
  const types = getTypes();
  const quoteMode = state.quoteLoading
    ? "Calcul en cours"
    : state.quote
      ? "API"
      : state.quoteError || "Pret";
  const sync = state.syncStatus;
  const syncLabel = !state.apiOnline
    ? "Non disponible"
    : state.syncing
      ? "Synchronisation..."
      : sync?.is_synchronized
        ? "Synchronisé"
        : sync?.needs_sync
          ? "À synchroniser"
          : "Statut inconnu";
  const syncDelta = sync?.delta
    ? `${formatNumber(sync.delta.new_count || 0)} nouveaux · ${formatNumber(sync.delta.modified_count || 0)} modifiés · ${sync.delta.removed_count === null || sync.delta.removed_count === undefined ? "-" : formatNumber(sync.delta.removed_count)} supprimés`
    : state.syncError || "Delta non chargé";

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">CT</span>
          <div>
            <strong>Cloud Temple Calculator</strong>
            <span>Catalogue YAML QuoteFlow extrait en application autonome</span>
          </div>
        </div>
          <div class="topbar__meta">
            <span class="status-pill ${state.apiOnline ? "is-online" : "is-offline"}">${state.apiOnline ? "API connectée" : "API hors ligne"}</span>
            <span class="sync-pill ${sync?.is_synchronized ? "is-synced" : "needs-sync"}">${escapeHtml(syncLabel)}</span>
            <span>${formatNumber(state.health?.catalog_items || state.catalogTotal)} produits</span>
            <span>${formatNumber(state.health?.license_items || state.licenseTotal)} licences</span>
          </div>
      </header>

      ${
        state.apiOnline
          ? ""
          : `<section class="notice notice--error">
              <strong>${escapeHtml(state.apiError || "API indisponible")}</strong>
              <span>Le frontend n'affiche plus de faux catalogue de démo. Il attend le backend FastAPI du projet calculator.</span>
            </section>`
      }

      <section class="workspace">
        <aside class="filters-panel" aria-label="Filtres catalogue">
          <div class="panel-heading">
            <p class="eyebrow">Catalogue</p>
            <h2>Filtres</h2>
          </div>
          <div class="filter-group">
            <h3>Familles</h3>
            ${families.map((family) => sidebarButton(family, state.activeFamily === family.label, "data-family")).join("")}
          </div>
          <div class="filter-group">
            <h3>Types</h3>
            ${types.slice(0, 16).map((type) => sidebarButton(type, state.activeType === type.label, "data-type")).join("")}
          </div>
        </aside>

        <section class="catalog-panel">
          <div class="toolbar">
            <label class="search-box">
              <span>Recherche</span>
              <input type="search" value="${escapeHtml(state.query)}" placeholder="SKU, produit, service, licence..." />
            </label>
            <div class="toolbar__summary">
              <strong>${formatNumber(visibleProducts.length)}</strong>
              <span>résultats affichés</span>
            </div>
          </div>

          <div class="stats-strip">
            <div>
              <span>Source</span>
              <strong>${state.apiOnline ? "API locale" : "Non connectée"}</strong>
            </div>
            <div>
              <span>Produits chargés</span>
              <strong>${formatNumber(state.catalogTotal || state.health?.catalog_items || 0)}</strong>
            </div>
            <div>
              <span>Licences disponibles</span>
              <strong>${formatNumber(state.health?.license_items || state.licenseTotal || 0)}</strong>
            </div>
            <div>
              <span>Base API</span>
              <strong>${escapeHtml(API_BASE)}</strong>
            </div>
            <div>
              <span>Synchro QuoteFlow</span>
              <strong>${escapeHtml(syncDelta)}</strong>
            </div>
          </div>

          <div class="sync-bar">
            <div>
              <strong>${escapeHtml(syncLabel)}</strong>
              <span>${escapeHtml(state.syncError || "Source locale QuoteFlow vers backend/data")}</span>
            </div>
            <button class="secondary-action" data-sync-catalog ${state.apiOnline && !state.syncing ? "" : "disabled"}>
              ${state.syncing ? "Synchronisation..." : "Synchroniser"}
            </button>
          </div>

          ${
            state.loading
              ? `<div class="empty-state">Chargement du catalogue...</div>`
              : visibleProducts.length
                ? `<div class="catalog-list">${visibleProducts.map(itemRow).join("")}</div>`
                : `<div class="empty-state">${state.apiOnline ? "Aucun résultat pour ce filtre." : "Catalogue indisponible tant que l'API ne répond pas."}</div>`
          }
        </section>

        <aside class="quote-panel" aria-label="Devis">
          <div class="quote-panel__header">
            <div>
              <p class="eyebrow">Simulation · ${escapeHtml(quoteMode)}</p>
              <h2>Panier</h2>
            </div>
            <span>${totals.rows.length} lignes</span>
          </div>

          <div class="quote-controls">
            <label>
              <span>Période</span>
              <select data-period>
                ${[1, 12, 24, 36]
                  .map(
                    (period) => `
                      <option value="${period}" ${period === state.period ? "selected" : ""}>
                        ${period} mois
                      </option>
                    `,
                  )
                  .join("")}
              </select>
            </label>
            <label>
              <span>Remise</span>
              <input type="range" min="0" max="40" step="1" value="${state.discount}" data-discount />
              <strong>${state.discount}%</strong>
            </label>
          </div>

          <ul class="cart-list">
            ${totals.rows.length ? totals.rows.map(cartLine).join("") : `<li class="empty-cart">Sélectionnez une ligne catalogue pour commencer.</li>`}
          </ul>

          <div class="summary">
            <div>
              <span>Mensuel public</span>
              <strong>${formatMoney(totals.publicMonthly)}</strong>
            </div>
            <div>
              <span>Mensuel remisé</span>
              <strong>${formatMoney(totals.monthly)}</strong>
            </div>
            <div>
              <span>Projection ${state.period} mois</span>
              <strong>${formatMoney(totals.periodTotal)}</strong>
            </div>
            <div>
              <span>Économie estimée</span>
              <strong>${formatMoney(totals.savings)}</strong>
            </div>
          </div>

          <button class="primary-action" data-quote-refresh ${state.cart.length ? "" : "disabled"}>Recalculer</button>
        </aside>
      </section>
    </main>
  `;

  app.querySelector(".search-box input").addEventListener("input", (event) =>
    setQuery(event.target.value),
  );

  app.querySelectorAll("[data-family]").forEach((button) => {
    button.addEventListener("click", () => setFamily(button.dataset.family));
  });

  app.querySelectorAll("[data-type]").forEach((button) => {
    button.addEventListener("click", () => setType(button.dataset.type));
  });

  app.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () =>
      addToCart(button.dataset.add, button.dataset.source || "auto"),
    );
  });

  app.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeFromCart(button.dataset.remove));
  });

  app.querySelectorAll("[data-quantity]").forEach((input) => {
    input.addEventListener("change", () =>
      updateQuantity(input.dataset.quantity, input.value),
    );
  });

  app.querySelector("[data-period]").addEventListener("change", (event) =>
    setPeriod(event.target.value),
  );

  app.querySelector("[data-discount]").addEventListener("input", (event) =>
    setDiscount(event.target.value),
  );

  app.querySelector("[data-quote-refresh]").addEventListener("click", () =>
    calculateRemoteQuote(),
  );

  app.querySelector("[data-sync-catalog]").addEventListener("click", () =>
    runCatalogSync(),
  );

  if (restoreSearch) {
    const searchInput = app.querySelector(".search-box input");
    searchInput.focus();
    searchInput.setSelectionRange(searchSelection, searchSelection);
  }
};

render();
loadInitialData();
