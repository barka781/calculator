(function exposeQuoteCore(root) {
  function roundMoney(value) {
    return Math.round((Number(value) + 0.0000001) * 100) / 100;
  }

  function roundUnit(value) {
    return Math.round((Number(value) + 0.0000001) * 10000) / 10000;
  }

  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function engagementMonths(value) {
    const match = /(\d+)\s*mois/i.exec(String(value || ""));
    return match ? Number(match[1]) : 1;
  }

  function findLocalItem(line, catalog, licenses) {
    if (line.source === "catalog") return catalog.find((item) => item.sku === line.sku) || null;
    if (line.source === "license") return licenses.find((item) => item.sku === line.sku) || null;
    return (
      catalog.find((item) => item.sku === line.sku) ||
      licenses.find((item) => item.sku === line.sku) ||
      null
    );
  }

  function calculateLocalQuote({ lines, catalog, licenses, periodMonths, discountPercent }) {
    const period = Math.max(1, Math.min(120, Math.round(toNumber(periodMonths, 12))));
    const commercialPct = Math.max(0, Math.min(100, toNumber(discountPercent, 0)));
    const extraFactor = 1 - commercialPct / 100;
    let monthlyPublicTotal = 0;
    let monthlyDiscountedTotal = 0;
    let engagementTotalSum = 0;

    const responseLines = lines.map((line) => {
      const item = findLocalItem(line, catalog || [], licenses || []);
      if (!item) throw new Error(`SKU introuvable localement: ${line.sku}`);

      const source = item.source === "license" ? "license" : "catalog";
      const quantity = toNumber(line.quantity, 1);
      const publicUnit = toNumber(item.publicPrice, 0);
      const standardPct = toNumber(item.discountPct, 0);
      const discountedUnit = publicUnit * (1 - standardPct / 100) * extraFactor;
      const publicMonthly = publicUnit * quantity;
      const monthlyTotal = discountedUnit * quantity;
      const months = engagementMonths(item.engagement);
      const engagementTotal = monthlyTotal * months;

      monthlyPublicTotal += publicMonthly;
      monthlyDiscountedTotal += monthlyTotal;
      engagementTotalSum += engagementTotal;

      return {
        sku: line.sku,
        name: item.name || line.name || line.sku,
        source,
        unit: item.unit || line.unit || "unité",
        quantity,
        public_unit_price: roundUnit(publicUnit),
        discounted_unit_price: roundUnit(discountedUnit),
        standard_discount_percent: roundMoney(standardPct),
        monthly_total: roundMoney(monthlyTotal),
        engagement_months: months,
        engagement_total: roundMoney(engagementTotal),
      };
    });

    return {
      status: "success",
      currency: "EUR",
      period_months: period,
      discount_percent: commercialPct,
      lines: responseLines,
      monthly_public_total: roundMoney(monthlyPublicTotal),
      monthly_discounted_total: roundMoney(monthlyDiscountedTotal),
      period_public_total: roundMoney(monthlyPublicTotal * period),
      period_discounted_total: roundMoney(monthlyDiscountedTotal * period),
      savings_total: roundMoney((monthlyPublicTotal - monthlyDiscountedTotal) * period),
      total_on_engagement: roundMoney(engagementTotalSum),
      local_fallback: true,
    };
  }

  const api = { calculateLocalQuote, engagementMonths, roundMoney, roundUnit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalculatorQuoteCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
