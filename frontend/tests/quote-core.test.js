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
  { sku: "LIC-1", source: "license", name: "Licence", unit: "licence", publicPrice: 20, discountPct: 0 },
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
