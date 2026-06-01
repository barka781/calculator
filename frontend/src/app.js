const API_BASE =
  window.CALCULATOR_API_BASE ||
  localStorage.getItem("calculatorApiBase") ||
  "http://127.0.0.1:8001";

const demoProducts = [
  {
    sku: "csp:fr1:iaas:vmware:standard:v3",
    name: "VMWARE:V3:STD",
    family: "Compute",
    type: "VMware",
    unit: "Lame",
    price: 3806.83,
    defaultQuantity: 1,
    minQuantity: 1,
    description:
      "32 cores / 64 threads, Intel Silver 4314, 384 Go RAM, plateforme SNC.",
    tags: ["SNC", "384 Go", "Standard"],
    accent: "blue",
    source: "catalog",
  },
  {
    sku: "csp:fr1:iaas:storage:bloc:premium:v1",
    name: "Datastore Premium",
    family: "Stockage",
    type: "Flash",
    unit: "Gio",
    price: 0.1176,
    defaultQuantity: 1024,
    minQuantity: 1,
    description: "Stockage Flash 3000 IOPS/To, réplication synchrone.",
    tags: ["SNC", "3000 IOPS/To", "Bloc"],
    accent: "mint",
    source: "catalog",
  },
  {
    sku: "9GS-00495",
    name: "CIS Suite Datacenter Core",
    family: "Licences",
    type: "Microsoft SPLA",
    unit: "2 Cores",
    price: 56.54,
    defaultQuantity: 8,
    minQuantity: 1,
    description: "Licence Microsoft SPLA mensuelle, édition Datacenter.",
    tags: ["SPLA", "Datacenter", "Core"],
    accent: "coral",
    source: "license",
  },
];

const state = {
  activeFamily: "Tous",
  apiError: "",
  apiOnline: false,
  cart: [
    { sku: "csp:fr1:iaas:vmware:standard:v3", quantity: 1, source: "auto" },
    { sku: "csp:fr1:iaas:storage:bloc:premium:v1", quantity: 2048, source: "auto" },
    { sku: "9GS-00495", quantity: 16, source: "auto" },
  ],
  catalogTotal: 0,
  discount: 25,
  health: null,
  licenseTotal: 0,
  loading: true,
  period: 12,
  products: demoProducts,
  query: "",
  quote: null,
  quoteError: "",
  quoteLoading: false,
};

const app = document.querySelector("#app");
let quoteTimer = null;
let quoteRequestId = 0;
let searchTimer = null;
let licenseSearchRequestId = 0;

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

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const buildUrl = (path, params = {}) => {
  const url = new URL(path, API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`);
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

const getAccent = (family) =>
  ({
    Compute: "blue",
    Stockage: "mint",
    Sauvegarde: "amber",
    Réseau: "violet",
    PaaS: "blue",
    Services: "amber",
    Licences: "coral",
  })[family] || "blue";

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
    .slice(0, 3);

const normalizeCatalogItem = (item) => {
  const family = getFamily(item);
  const summary = item.pricing_summary || {};
  const specs = item.specs || {};
  const metadata = item.metadata || {};
  const unit = summary.unit || item.unit || "unité";

  return {
    sku: item.sku,
    name: item.name || item.title || item.sku,
    family,
    type: item.sub_type || item.type || family,
    unit,
    price: Number(summary.public_price || 0),
    defaultQuantity: getDefaultQuantity(unit, family),
    minQuantity: Number(summary.min_quantity || 1),
    description: item.description || `${item.type || family} · ${item.source_file || "catalogue"}`,
    tags: compactTags([
      metadata.snc ? "SNC" : "",
      specs.ram ? `${specs.ram} Go RAM` : "",
      specs.iops_per_tb ? `${specs.iops_per_tb} IOPS/To` : "",
      item.type,
    ]),
    accent: getAccent(family),
    source: "catalog",
  };
};

const normalizeLicenseItem = (item) => ({
  sku: item.sku,
  name: item.name || item.sku,
  family: "Licences",
  type: item.vendor || "Licence",
  unit: item.unit || "unité",
  price: Number(item.price || item.pricing?.public_price || 0),
  defaultQuantity: getDefaultQuantity(item.unit, "Licences"),
  minQuantity: 1,
  description: item.description || [item.vendor, item.edition].filter(Boolean).join(" · "),
  tags: compactTags([item.vendor, item.edition, item.pricing?.term]),
  accent: "coral",
  source: "license",
});

const productKey = (item) => `${item.source || "auto"}:${item.sku}`;

const mergeProducts = (...groups) => {
  const byKey = new Map();
  groups.flat().forEach((item) => {
    if (item?.sku) byKey.set(productKey(item), item);
  });
  return Array.from(byKey.values()).sort((a, b) =>
    `${a.family}${a.name}`.localeCompare(`${b.family}${b.name}`, "fr"),
  );
};

const getFamilies = () => {
  const available = new Set(state.products.map((item) => item.family));
  return familyOrder.filter((family) => family === "Tous" || available.has(family));
};

const findProduct = (sku, preferredSource = "auto") => {
  if (preferredSource !== "auto") {
    const exact = state.products.find(
      (item) => item.sku === sku && item.source === preferredSource,
    );
    if (exact) return exact;
  }
  return state.products.find((item) => item.sku === sku);
};

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
  const periodTotal = state.quote?.period_discounted_total ?? monthly * state.period;
  const savings = state.quote?.savings_total ?? (publicMonthly - monthly) * state.period;

  return {
    rows,
    monthly,
    publicMonthly,
    periodTotal,
    savings,
  };
};

const matchesSearch = (item) => {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [item.name, item.sku, item.family, item.type, item.description]
    .join(" ")
    .toLowerCase()
    .includes(query);
};

const getVisibleProducts = () =>
  state.products.filter((item) => {
    const familyMatch =
      state.activeFamily === "Tous" || item.family === state.activeFamily;
    return familyMatch && matchesSearch(item);
  });

const isInCart = (sku) => state.cart.some((line) => line.sku === sku);

const scheduleQuote = () => {
  window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(calculateRemoteQuote, 220);
};

const scheduleLicenseSearch = () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadRemoteLicensesForSearch, 260);
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
  line.quantity = Math.max(product.minQuantity, Number(quantity) || 0);
  state.quote = null;
  render();
  scheduleQuote();
};

const setFamily = (family) => {
  state.activeFamily = family;
  render();
  if (family === "Licences") scheduleLicenseSearch();
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

const hydrateSelectedLines = async () => {
  const missingLines = state.cart.filter((line) => !findProduct(line.sku, line.source));
  const hydrated = [];

  for (const line of missingLines) {
    try {
      const catalogItem = await fetchJson(`api/catalog/${encodeURIComponent(line.sku)}`);
      hydrated.push(normalizeCatalogItem(catalogItem));
      continue;
    } catch {
      // Try licenses below.
    }

    try {
      const licenseItem = await fetchJson(`api/licenses/${encodeURIComponent(line.sku)}`);
      hydrated.push(normalizeLicenseItem(licenseItem));
    } catch {
      // The line will stay hidden until a matching item is available.
    }
  }

  if (hydrated.length) {
    state.products = mergeProducts(state.products, hydrated);
  }
};

const loadInitialData = async () => {
  state.loading = true;
  render();

  try {
    const [health, catalog] = await Promise.all([
      fetchJson("health"),
      fetchJson("api/catalog", { params: { limit: 1000 } }),
    ]);

    state.health = health;
    state.catalogTotal = catalog.total || catalog.items?.length || 0;
    state.apiOnline = true;
    state.apiError = "";
    state.products = mergeProducts((catalog.items || []).map(normalizeCatalogItem));

    await hydrateSelectedLines();
    await loadRemoteLicensesForSearch(true);
  } catch (error) {
    state.apiOnline = false;
    state.apiError = "Mode démo actif";
    state.products = demoProducts;
  } finally {
    state.loading = false;
    render();
    scheduleQuote();
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
      params: { q: query || undefined, limit: 80 },
    });
    if (requestId !== licenseSearchRequestId) return;
    state.licenseTotal = response.total || response.items?.length || 0;
    state.products = mergeProducts(
      state.products.filter((item) => item.source !== "license" || isInCart(item.sku)),
      (response.items || []).map(normalizeLicenseItem),
    );
    render();
  } catch {
    // Keep existing products; a transient license search failure should not disrupt quoting.
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
  } catch (error) {
    if (requestId !== quoteRequestId) return;
    state.quote = null;
    state.quoteError = "Calcul local";
  } finally {
    if (requestId === quoteRequestId) {
      state.quoteLoading = false;
      render();
    }
  }
};

const productCard = (item) => {
  const selected = isInCart(item.sku);
  return `
    <article class="product-card product-card--${escapeHtml(item.accent)}">
      <div class="product-card__top">
        <div>
          <p class="eyebrow">${escapeHtml(item.family)} · ${escapeHtml(item.type)}</p>
          <h3>${escapeHtml(item.name)}</h3>
        </div>
        <div class="price-pill">
          <strong>${formatMoney(item.price)}</strong>
          <span>/${escapeHtml(item.unit)}</span>
        </div>
      </div>
      <p class="product-card__desc">${escapeHtml(item.description)}</p>
      <div class="tag-row">
        ${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="product-card__bottom">
        <code>${escapeHtml(item.sku)}</code>
        <button class="icon-action ${selected ? "is-selected" : ""}" data-add="${escapeHtml(item.sku)}" data-source="${escapeHtml(item.source)}" aria-label="Ajouter ${escapeHtml(item.name)}">
          ${selected ? "Ajouté" : "Ajouter"}
        </button>
      </div>
    </article>
  `;
};

const cartLine = (line) => `
  <li class="cart-line">
    <div class="cart-line__main">
      <div>
        <strong>${escapeHtml(line.name)}</strong>
        <span>${escapeHtml(line.family)} · ${escapeHtml(line.unit)}</span>
      </div>
      <button class="ghost-icon" data-remove="${escapeHtml(line.sku)}" aria-label="Retirer ${escapeHtml(line.name)}">×</button>
    </div>
    <div class="cart-line__controls">
      <label>
        <span>Qté</span>
        <input type="number" min="${line.minQuantity}" value="${line.quantity}" data-quantity="${escapeHtml(line.sku)}" />
      </label>
      <div class="line-total">
        <span>${formatMoney(line.apiLine?.public_unit_price ?? line.price)} / ${escapeHtml(line.unit)}</span>
        <strong>${formatMoney(getLineTotal(line))}</strong>
      </div>
    </div>
  </li>
`;

const render = () => {
  const activeElement = document.activeElement;
  const restoreSearch =
    activeElement && activeElement.matches && activeElement.matches(".search-box input");
  const searchSelection = restoreSearch ? activeElement.selectionStart : null;
  const visibleProducts = getVisibleProducts();
  const totals = getTotals();
  const computeLines = totals.rows.filter((line) => line.family === "Compute");
  const storageLines = totals.rows.filter((line) => line.family === "Stockage");
  const licenseLines = totals.rows.filter((line) => line.family === "Licences");
  const families = getFamilies();
  const statusLabel = state.apiOnline ? "API connectée" : state.apiError || "Connexion...";
  const quoteMode = state.quoteLoading
    ? "Calcul..."
    : state.quote
      ? "API"
      : state.quoteError || "Local";

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">CT</span>
          <div>
            <strong>Cloud Temple Calculator</strong>
            <span>Devis cloud public · S1-2026</span>
          </div>
        </div>
        <div class="topbar__meta">
          <span class="status-pill ${state.apiOnline ? "is-online" : "is-offline"}">${escapeHtml(statusLabel)}</span>
          <span>${formatNumber(state.health?.catalog_items || state.catalogTotal || state.products.length)} offres</span>
          <span>${state.period} mois</span>
        </div>
      </header>

      <section class="workspace">
        <section class="catalog-panel">
          <div class="hero-grid">
            <div class="hero-copy">
              <p class="eyebrow">Quote builder</p>
              <h1>Compose, chiffre, ajuste.</h1>
              <p class="hero-copy__body">
                Le catalogue Cloud Temple branché sur l'API locale, avec un devis recalculé à chaque variation.
              </p>
            </div>
            <div class="quote-visual" aria-label="Architecture sélectionnée">
              <div class="visual-node visual-node--compute">
                <span>Compute</span>
                <strong>${computeLines.length || 0}</strong>
              </div>
              <div class="visual-link"></div>
              <div class="visual-node visual-node--storage">
                <span>Stockage</span>
                <strong>${formatNumber(
                  storageLines.reduce((sum, line) => sum + line.quantity, 0),
                )} Gio</strong>
              </div>
              <div class="visual-node visual-node--license">
                <span>Licences</span>
                <strong>${licenseLines.length || 0}</strong>
              </div>
            </div>
          </div>

          <div class="toolbar">
            <label class="search-box">
              <span>Recherche</span>
              <input type="search" value="${escapeHtml(state.query)}" placeholder="SKU, service, licence..." />
            </label>
            <div class="segmented" role="tablist" aria-label="Familles">
              ${families
                .map(
                  (family) => `
                    <button class="${state.activeFamily === family ? "active" : ""}" data-family="${escapeHtml(family)}">
                      ${escapeHtml(family)}
                    </button>
                  `,
                )
                .join("")}
            </div>
          </div>

          ${
            state.loading
              ? `<div class="empty-state">Chargement du catalogue...</div>`
              : `<div class="product-grid">
                  ${
                    visibleProducts.length
                      ? visibleProducts.map(productCard).join("")
                      : `<div class="empty-state">Aucune offre trouvée</div>`
                  }
                </div>`
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
            ${totals.rows.length ? totals.rows.map(cartLine).join("") : `<li class="empty-cart">Aucune ligne sélectionnée</li>`}
          </ul>

          <div class="summary">
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

          <button class="primary-action" data-quote-refresh>Recalculer</button>
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

  if (restoreSearch) {
    const searchInput = app.querySelector(".search-box input");
    searchInput.focus();
    searchInput.setSelectionRange(searchSelection, searchSelection);
  }
};

render();
loadInitialData();
