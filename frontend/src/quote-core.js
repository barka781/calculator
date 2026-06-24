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

  // Miroir de backend `_term_info` : nature tarifaire d'une ligne.
  // -> { term, termMonths, recurring }. Catalogue = mensuel récurrent. Licences :
  // terme via item.term, durée pluriannuelle via item.engagement (années), perpétuel
  // / one-shot / inconnu -> coût ponctuel (jamais multiplié par la projection).
  function termInfo(item) {
    if (!item || item.source !== "license") return { term: null, termMonths: 1, recurring: true };
    const key = String(item.term || "").trim().toLowerCase();
    if (key === "monthly") return { term: item.term, termMonths: 1, recurring: true };
    if (key === "annual") return { term: item.term, termMonths: 12, recurring: true };
    if (key === "multiyear") {
      const years = Number(item.engagement);
      if (Number.isFinite(years) && years > 0) return { term: item.term, termMonths: Math.round(years) * 12, recurring: true };
      return { term: item.term, termMonths: 0, recurring: false };
    }
    return { term: item.term || null, termMonths: 0, recurring: false };
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

  function calculateLocalQuote({ lines, catalog, licenses, periodMonths, discountPercent, partner }) {
    const period = Math.max(1, Math.min(120, Math.round(toNumber(periodMonths, 12))));
    // Miroir du backend : prix publics par défaut ; la remise catalogue (taux par
    // produit) ne s'applique qu'en mode partenaire. `discountPercent` = remise
    // additionnelle optionnelle (masquée dans l'UI, défaut 0).
    const isPartner = Boolean(partner);
    // Miroir backend : la remise additionnelle ne s'applique qu'en mode partenaire.
    const extraPct = isPartner ? Math.max(0, Math.min(100, toNumber(discountPercent, 0))) : 0;
    const extraFactor = 1 - extraPct / 100;
    let monthlyPublicTotal = 0;
    let monthlyDiscountedTotal = 0;
    let oneTimePublicTotal = 0;
    let oneTimeDiscountedTotal = 0;
    let engagementTotalSum = 0;

    const responseLines = lines.map((line) => {
      const item = findLocalItem(line, catalog || [], licenses || []);
      if (!item) throw new Error(`SKU introuvable localement: ${line.sku}`);

      const source = item.source === "license" ? "license" : "catalog";
      const quantity = toNumber(line.quantity, 1);
      const publicUnit = toNumber(item.publicPrice, 0);
      const standardPct = isPartner ? toNumber(item.discountPct, 0) : 0;
      const discountedUnit = publicUnit * (1 - standardPct / 100) * extraFactor;
      const { term, termMonths, recurring } = termInfo(item);

      let monthlyTotal = 0;
      let oneTimeTotal = 0;
      let lineEngagementMonths = 0;
      let engagementTotal = 0;
      if (recurring) {
        // Prix natif amorti sur les mois couverts -> mensuel équivalent.
        const months = termMonths || 1;
        monthlyTotal = (discountedUnit / months) * quantity;
        lineEngagementMonths = source === "license" ? termMonths : engagementMonths(item.engagement);
        engagementTotal = monthlyTotal * lineEngagementMonths;
        monthlyPublicTotal += (publicUnit / months) * quantity;
        monthlyDiscountedTotal += monthlyTotal;
      } else {
        // Coût ponctuel (perpétuel / one-shot) : compté une fois, hors projection.
        oneTimeTotal = discountedUnit * quantity;
        engagementTotal = oneTimeTotal;
        oneTimePublicTotal += publicUnit * quantity;
        oneTimeDiscountedTotal += oneTimeTotal;
      }
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
        term: term || null,
        term_months: termMonths,
        recurring,
        monthly_total: roundMoney(monthlyTotal),
        one_time_total: roundMoney(oneTimeTotal),
        engagement_months: lineEngagementMonths,
        engagement_total: roundMoney(engagementTotal),
      };
    });

    const periodPublicTotal = monthlyPublicTotal * period + oneTimePublicTotal;
    const periodDiscountedTotal = monthlyDiscountedTotal * period + oneTimeDiscountedTotal;

    return {
      status: "success",
      currency: "EUR",
      period_months: period,
      partner: isPartner,
      discount_percent: extraPct,
      lines: responseLines,
      monthly_public_total: roundMoney(monthlyPublicTotal),
      monthly_discounted_total: roundMoney(monthlyDiscountedTotal),
      one_time_total: roundMoney(oneTimeDiscountedTotal),
      period_public_total: roundMoney(periodPublicTotal),
      period_discounted_total: roundMoney(periodDiscountedTotal),
      savings_total: roundMoney(periodPublicTotal - periodDiscountedTotal),
      total_on_engagement: roundMoney(engagementTotalSum),
      local_fallback: true,
    };
  }

  const api = { calculateLocalQuote, engagementMonths, roundMoney, roundUnit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalculatorQuoteCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
