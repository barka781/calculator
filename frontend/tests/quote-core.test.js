const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateLocalQuote, engagementMonths } = require("../src/quote-core.js");

test("local quote applies standard then commercial discounts", () => {
  const quote = calculateLocalQuote({
    periodMonths: 12,
    discountPercent: 5,
    catalog: [
      {
        sku: "COMPUTE-1",
        source: "catalog",
        name: "Compute",
        unit: "unité",
        publicPrice: 100,
        discountPct: 10,
        engagement: "12 mois",
      },
    ],
    licenses: [
      {
        sku: "LIC-1",
        source: "license",
        name: "Licence",
        unit: "licence",
        publicPrice: 20,
        discountPct: 0,
      },
    ],
    lines: [
      { sku: "COMPUTE-1", source: "catalog", quantity: 2 },
      { sku: "LIC-1", source: "license", quantity: 3 },
    ],
  });

  assert.equal(quote.status, "success");
  assert.equal(quote.lines[0].discounted_unit_price, 85.5);
  assert.equal(quote.lines[0].monthly_total, 171);
  assert.equal(quote.lines[0].engagement_months, 12);
  assert.equal(quote.lines[0].engagement_total, 2052);
  assert.equal(quote.lines[1].monthly_total, 57);
  assert.equal(quote.monthly_public_total, 260);
  assert.equal(quote.monthly_discounted_total, 228);
  assert.equal(quote.period_discounted_total, 2736);
  assert.equal(quote.savings_total, 384);
  assert.equal(quote.local_fallback, true);
});

test("engagement parser falls back to one month", () => {
  assert.equal(engagementMonths("36 mois"), 36);
  assert.equal(engagementMonths("Aucun"), 1);
  assert.equal(engagementMonths(""), 1);
});
