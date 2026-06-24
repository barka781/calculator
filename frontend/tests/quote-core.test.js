const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateLocalQuote, engagementMonths } = require("../src/quote-core.js");

const CATALOG = [
  {
    sku: "COMPUTE-1",
    source: "catalog",
    name: "Compute",
    unit: "unité",
    publicPrice: 100,
    discountPct: 10,
    engagement: "12 mois",
  },
];
const LICENSES = [
  { sku: "LIC-1", source: "license", name: "Licence", unit: "licence", publicPrice: 20, discountPct: 0, term: "monthly" },
];
const LINES = [
  { sku: "COMPUTE-1", source: "catalog", quantity: 2 },
  { sku: "LIC-1", source: "license", quantity: 3 },
];

test("local quote keeps public prices by default (no partner)", () => {
  const quote = calculateLocalQuote({
    periodMonths: 12,
    catalog: CATALOG,
    licenses: LICENSES,
    lines: LINES,
  });

  assert.equal(quote.status, "success");
  assert.equal(quote.partner, false);
  assert.equal(quote.lines[0].standard_discount_percent, 0); // remise catalogue NON appliquée
  assert.equal(quote.lines[0].discounted_unit_price, 100); // == prix public
  assert.equal(quote.lines[0].monthly_total, 200); // 100 * 2
  assert.equal(quote.lines[0].engagement_total, 2400); // 200 * 12
  assert.equal(quote.lines[1].monthly_total, 60); // 20 * 3
  assert.equal(quote.monthly_public_total, 260);
  assert.equal(quote.monthly_discounted_total, 260); // == public, aucune remise
  assert.equal(quote.savings_total, 0);
  assert.equal(quote.local_fallback, true);
});

test("local quote applies catalog discount in partner mode", () => {
  const quote = calculateLocalQuote({
    periodMonths: 12,
    partner: true,
    catalog: CATALOG,
    licenses: LICENSES,
    lines: LINES,
  });

  assert.equal(quote.partner, true);
  assert.equal(quote.lines[0].standard_discount_percent, 10);
  assert.equal(quote.lines[0].discounted_unit_price, 90); // 100 * 0.9
  assert.equal(quote.lines[0].monthly_total, 180); // 90 * 2
  assert.equal(quote.lines[1].monthly_total, 60); // licence discountPct 0 -> public
  assert.equal(quote.monthly_discounted_total, 240); // 180 + 60
  assert.equal(quote.savings_total, 240); // (260 - 240) * 12
});

test("local quote stacks manual discount on partner discount", () => {
  const quote = calculateLocalQuote({
    periodMonths: 12,
    partner: true,
    discountPercent: 5,
    catalog: CATALOG,
    licenses: [],
    lines: [{ sku: "COMPUTE-1", source: "catalog", quantity: 1 }],
  });

  // 100 * 0.9 (partenaire) * 0.95 (manuel) = 85.5
  assert.equal(quote.lines[0].discounted_unit_price, 85.5);
});

test("local quote ignores manual discount without partner", () => {
  // Miroir backend : hors partenaire, une remise manuelle résiduelle est ignorée.
  const quote = calculateLocalQuote({
    periodMonths: 12,
    discountPercent: 25,
    catalog: CATALOG,
    licenses: [],
    lines: [{ sku: "COMPUTE-1", source: "catalog", quantity: 1 }],
  });

  assert.equal(quote.partner, false);
  assert.equal(quote.discount_percent, 0); // remise neutralisée hors partenaire
  assert.equal(quote.lines[0].discounted_unit_price, 100); // prix public, remise IGNORÉE
});

test("engagement parser falls back to one month", () => {
  assert.equal(engagementMonths("36 mois"), 36);
  assert.equal(engagementMonths("Aucun"), 1);
  assert.equal(engagementMonths(""), 1);
});

// Bug L4 (miroir backend) : terme tarifaire des licences (annual / multiyear / perpétuel).
test("local quote amortizes an annual license to its monthly equivalent", () => {
  const quote = calculateLocalQuote({
    periodMonths: 12,
    catalog: [],
    licenses: [{ sku: "LIC-A", source: "license", name: "Annuelle", unit: "licence", publicPrice: 7551.91, discountPct: 0, term: "annual", engagement: 1 }],
    lines: [{ sku: "LIC-A", source: "license", quantity: 1 }],
  });
  const line = quote.lines[0];

  assert.equal(line.recurring, true);
  assert.equal(line.term_months, 12);
  assert.equal(line.public_unit_price, 7551.91); // prix natif annuel conservé
  assert.equal(line.monthly_total, 629.33); // 7551.91 / 12 (mensuel amorti)
  assert.equal(line.one_time_total, 0);
  assert.equal(quote.monthly_discounted_total, 629.33);
  assert.equal(quote.period_discounted_total, 7551.91); // 12 mois = 1 an (et NON 90 622,92)
  assert.equal(quote.one_time_total, 0);
  assert.equal(line.engagement_total, 7551.91);
});

test("local quote uses engagement years for a multiyear license", () => {
  const quote = calculateLocalQuote({
    periodMonths: 36,
    catalog: [],
    licenses: [{ sku: "LIC-M", source: "license", name: "Pluri", unit: "licence", publicPrice: 14706.34, discountPct: 0, term: "multiyear", engagement: 3 }],
    lines: [{ sku: "LIC-M", source: "license", quantity: 1 }],
  });
  const line = quote.lines[0];

  assert.equal(line.term_months, 36); // 3 ans × 12, pas le suffixe SKU
  assert.equal(line.monthly_total, 408.51); // 14706.34 / 36
  assert.equal(quote.period_discounted_total, 14706.34); // 36 mois = le bundle (et NON 529 428)
  assert.equal(quote.one_time_total, 0);
});

test("local quote treats a perpetual license as a one-time cost, invariant to projection", () => {
  const licenses = [{ sku: "LIC-P", source: "license", name: "Perp", unit: "licence", publicPrice: 161.48, discountPct: 0, term: "", engagement: "Perpetuel" }];
  const lines = [{ sku: "LIC-P", source: "license", quantity: 4 }];
  const q12 = calculateLocalQuote({ periodMonths: 12, catalog: [], licenses, lines });
  const q60 = calculateLocalQuote({ periodMonths: 60, catalog: [], licenses, lines });

  assert.equal(q12.lines[0].recurring, false);
  assert.equal(q12.lines[0].monthly_total, 0);
  assert.equal(q12.lines[0].one_time_total, 645.92); // 161.48 × 4
  assert.equal(q12.monthly_discounted_total, 0);
  assert.equal(q12.one_time_total, 645.92);
  assert.equal(q12.period_discounted_total, 645.92); // compté une seule fois
  assert.equal(q60.period_discounted_total, 645.92); // INVARIANT à la projection
});
