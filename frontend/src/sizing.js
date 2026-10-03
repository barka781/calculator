/* Estimation guidée : traduit un besoin exprimé en serveurs virtuels (vCPU, RAM,
   disque) en lignes du catalogue réel, pour trois façons de les héberger :
   - VM Instances : VM mutualisées, facturées au vCPU et au Gio de RAM ;
   - OpenIaaS dédié / VMware dédié : lames entières réservées au client.
   Chaque option sépare le prix des serveurs du socle fixe (tenant, zone,
   support), payé une fois par environnement.

   Toutes les hypothèses de dimensionnement sont dans SIZING, à valider avec
   l'avant-vente. Module pur (aucun DOM), testé par frontend/tests/sizing.test.js. */
(function exposeSizing(root) {
  const SIZING = {
    vcpuPerThread: 2, // lames dédiées : 2 vCPU par thread physique
    ramUsableRatio: 0.9, // lames dédiées : 10 % de la RAM réservés à l'hyperviseur
    storageMargin: 1.1, // lames dédiées : marge sur les disques (snapshots, croissance)
    backupStorageRatio: 1.5, // lames dédiées : volume sauvegardé = 1,5 × disques
    vmiIncludedDiskGb: 50, // VM Instances : disque système inclus (15 à 100 Go selon l'OS)
    vmiHaFactor: 2, // VM Instances en haute disponibilité : chaque serveur doublé dans une 2e zone
    supportRate: 0.05, // support Standard : 5 % des ressources, 500 € minimum,
    supportMinimum: 500, // compté en forfaits entiers, arrondi au-dessus
    skus: {
      tenant: "csp:tenant:v1",
      az: "csp:fr1:iaas:az:v1",
      support: "csp:support:standard",
      storage: "csp:fr1:iaas:storage:bloc:medium:v1",
      vmBackup: "csp:fr1:iaas:backup:vm:v1",
      backupStorage: "csp:fr1:iaas:storage:backup:v1",
      vmiStorage: "csp:fr1:iaas:vmi:storage:standard:v1",
      vmi: {
        dev: { vcpu: "csp:fr1:iaas:vmi:dev:vcpu:v1", ram: "csp:fr1:iaas:vmi:dev:ram:v1" },
        gp: { vcpu: "csp:fr1:iaas:vmi:gp:vcpu:v1", ram: "csp:fr1:iaas:vmi:gp:ram:v1" },
        perf: { vcpu: "csp:fr1:iaas:vmi:perf:vcpu:v1", ram: "csp:fr1:iaas:vmi:perf:ram:v1" },
      },
    },
  };

  // Gabarits de serveur, décrits par l'usage plutôt que par la technique.
  const SIZES = [
    { id: "S", label: "Petit", vcpu: 2, ram: 4, disk: 50, hint: "Site vitrine, outil interne léger" },
    { id: "M", label: "Moyen", vcpu: 4, ram: 16, disk: 100, hint: "Application métier courante" },
    { id: "L", label: "Grand", vcpu: 8, ram: 32, disk: 250, hint: "Base de données, ERP" },
    { id: "XL", label: "Très grand", vcpu: 16, ram: 64, disk: 500, hint: "Forte charge, analytique" },
  ];

  // Points de départ préremplis : le visiteur ajuste ensuite.
  const USAGES = [
    {
      id: "business-app",
      label: "Application métier",
      hint: "ERP, CRM, logiciel de gestion",
      vmClass: "gp",
      servers: [
        { name: "Serveur d'application", size: "M", qty: 1 },
        { name: "Base de données", size: "L", qty: 1 },
      ],
    },
    {
      id: "website",
      label: "Site web ou portail",
      hint: "Site public, extranet, portail client",
      vmClass: "gp",
      servers: [
        { name: "Serveur web", size: "S", qty: 2 },
        { name: "Base de données", size: "M", qty: 1 },
      ],
    },
    {
      id: "file-server",
      label: "Serveur de fichiers",
      hint: "Partage de documents, archives",
      vmClass: "gp",
      servers: [{ name: "Serveur de fichiers", size: "M", qty: 1, disk: 1000 }],
    },
    {
      id: "test-env",
      label: "Environnement de test",
      hint: "Recette, développement, maquette",
      vmClass: "dev",
      servers: [{ name: "Serveur de test", size: "S", qty: 2 }],
    },
    {
      id: "custom",
      label: "Sur mesure",
      hint: "Je décris mes serveurs moi-même",
      vmClass: "gp",
      servers: [{ name: "Serveur", size: "M", qty: 1 }],
    },
  ];

  // Classes de VM Instances (prix par vCPU et par Gio de RAM au catalogue).
  const VM_CLASSES = [
    { id: "dev", label: "Dev", hint: "Développement : ressources mutualisées, pour le test et la recette." },
    { id: "gp", label: "Général", hint: "Usage général : ressources mutualisées, pour la production courante." },
    { id: "perf", label: "Perf", hint: "Performance : vCPU dédiés, pour les charges exigeantes." },
  ];

  // Façons d'héberger les serveurs, présentées côte à côte.
  const OFFERS = [
    {
      id: "vmi",
      label: "VM mutualisées",
      product: "VM Instances",
      hint: "Vous payez uniquement les ressources de vos VM, à l'heure. Le plus simple pour démarrer.",
    },
    {
      id: "openiaas",
      label: "Serveurs dédiés OpenIaaS",
      product: "IaaS OpenSource",
      hint: "Des lames physiques réservées à vous seul, virtualisation open source.",
    },
    {
      id: "vmware",
      label: "Serveurs dédiés VMware",
      product: "IaaS VMware",
      hint: "Des lames physiques réservées à vous seul, virtualisation VMware.",
    },
  ];

  const sizeById = (id) => SIZES.find((s) => s.id === id) || SIZES[1];

  // Serveur prérempli à partir d'un gabarit (le disque peut être surchargé).
  function serverFromSize(sizeId, extra = {}) {
    const s = sizeById(sizeId);
    return { name: extra.name || "Serveur", size: s.id, vcpu: s.vcpu, ram: s.ram, disk: extra.disk ?? s.disk, qty: extra.qty ?? 1 };
  }

  function usageById(id) {
    return USAGES.find((u) => u.id === id) || USAGES[0];
  }

  function serversForUsage(usageId) {
    return usageById(usageId).servers.map((s) => serverFromSize(s.size, s));
  }

  const positive = (v) => Math.max(0, Number(v) || 0);
  // Arrondi supérieur tolérant aux erreurs de virgule flottante (350 × 1,1 =
  // 385,00000000000006 en JavaScript ne doit pas devenir 386).
  const ceilSafe = (v) => Math.ceil(v - 1e-9);

  function totalsOf(servers) {
    return servers.reduce(
      (acc, s) => {
        const qty = Math.floor(positive(s.qty));
        if (!qty) return acc;
        acc.vms += qty;
        acc.vcpu += positive(s.vcpu) * qty;
        acc.ram += positive(s.ram) * qty;
        acc.disk += positive(s.disk) * qty;
        acc.extraDisk += Math.max(0, positive(s.disk) - SIZING.vmiIncludedDiskGb) * qty;
        acc.maxVcpu = Math.max(acc.maxVcpu, positive(s.vcpu));
        acc.maxRam = Math.max(acc.maxRam, positive(s.ram));
        return acc;
      },
      { vms: 0, vcpu: 0, ram: 0, disk: 0, extraDisk: 0, maxVcpu: 0, maxRam: 0 },
    );
  }

  /* ---------- Lames dédiées ---------- */

  function platformOf(item) {
    const m = /:iaas:(openiaas|vmware):/.exec(String(item.sku || ""));
    return m ? m[1] : null;
  }

  // Lames candidates : bonne plateforme, specs exploitables, prix connu, sans GPU.
  function bladeCandidates(catalog, platform) {
    return catalog.filter((item) => {
      const specs = item.specs || {};
      return (
        platformOf(item) === platform &&
        Number(specs.threads) > 0 &&
        Number(specs.ram) > 0 &&
        !specs.gpu &&
        Number(item.publicPrice) > 0
      );
    });
  }

  function bladeCapacity(item) {
    return {
      vcpu: Number(item.specs.threads) * SIZING.vcpuPerThread,
      ram: Number(item.specs.ram) * SIZING.ramUsableRatio,
    };
  }

  // Nombre de lames d'un modèle pour accueillir les serveurs, ou null si un
  // serveur ne tient pas sur une seule lame. Rangement réel, first-fit
  // décroissant sur vCPU et RAM : la somme des ressources ne suffit pas (cinq VM
  // de 45 vCPU ne se rangent pas sur deux lames de 128 vCPU). Les serveurs
  // identiques sont rangés par paquets : même résultat qu'un placement un par un,
  // sans coût quadratique quand on décrit des centaines de serveurs.
  function bladesNeeded(item, servers, ha) {
    const cap = bladeCapacity(item);
    const eps = 1e-9;
    const groups = servers
      .map((s) => ({ vcpu: positive(s.vcpu), ram: positive(s.ram), qty: Math.floor(positive(s.qty)) }))
      .filter((g) => g.qty > 0);
    if (groups.some((g) => g.vcpu > cap.vcpu + eps || g.ram > cap.ram + eps)) return null;
    const weight = (g) => Math.max(g.vcpu / cap.vcpu, g.ram / cap.ram);
    groups.sort((a, b) => weight(b) - weight(a));

    // Combien de serveurs d'un gabarit tiennent encore dans un espace libre.
    const fits = (freeVcpu, freeRam, g) =>
      Math.min(
        g.vcpu > 0 ? Math.floor((freeVcpu + eps) / g.vcpu) : Infinity,
        g.ram > 0 ? Math.floor((freeRam + eps) / g.ram) : Infinity,
      );

    const bins = [];
    for (const g of groups) {
      let left = g.qty;
      for (const bin of bins) {
        if (!left) break;
        const k = Math.min(left, fits(cap.vcpu - bin.vcpu, cap.ram - bin.ram, g));
        if (k > 0) {
          bin.vcpu += k * g.vcpu;
          bin.ram += k * g.ram;
          left -= k;
        }
      }
      const perBin = Math.max(1, Math.min(left, fits(cap.vcpu, cap.ram, g)));
      while (left > 0) {
        const k = Math.min(left, perBin);
        bins.push({ vcpu: k * g.vcpu, ram: k * g.ram });
        left -= k;
      }
    }
    let n = Math.max(bins.length, 1);
    if (ha) n = Math.max(n + 1, 2); // N+1 : une lame de secours
    return n;
  }

  // Modèle de lame le moins cher pour le besoin (à coût égal : moins de lames).
  function pickBlade(catalog, platform, servers, ha) {
    let best = null;
    for (const item of bladeCandidates(catalog, platform)) {
      const count = bladesNeeded(item, servers, ha);
      if (count === null) continue;
      const cost = count * Number(item.publicPrice);
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && count < best.count)) {
        best = { item, count, cost, capacity: bladeCapacity(item) };
      }
    }
    return best;
  }

  function dedicatedResourceLines(platform, totals, input, catalog) {
    const blade = pickBlade(catalog, platform, input.servers || [], !!input.ha);
    if (!blade) return { reason: "too_big" };
    const k = SIZING.skus;
    const lines = [
      { sku: blade.item.sku, quantity: blade.count, group: "servers", label: `Lames ${blade.item.name}` },
      { sku: k.storage, quantity: ceilSafe(totals.disk * SIZING.storageMargin), group: "servers", label: "Stockage des disques" },
    ];
    if (input.backup) {
      lines.push({ sku: k.vmBackup, quantity: totals.vms, group: "servers", label: "Sauvegarde des serveurs" });
      lines.push({
        sku: k.backupStorage,
        // Le panier compte en unités entières : Tio arrondi au-dessus (jamais sous-estimé).
        quantity: Math.max(1, ceilSafe((totals.disk * SIZING.backupStorageRatio) / 1024)),
        group: "servers",
        label: "Stockage des sauvegardes",
      });
    }
    return { lines, blade };
  }

  /* ---------- VM Instances ---------- */

  function vmiResourceLines(totals, input) {
    const skus = SIZING.skus.vmi[input.vmClass] || SIZING.skus.vmi.gp;
    // Haute disponibilité : chaque serveur est doublé dans une seconde zone.
    const f = input.ha ? SIZING.vmiHaFactor : 1;
    const suffix = input.ha ? " (doublés en 2 zones)" : "";
    const lines = [
      { sku: skus.vcpu, quantity: totals.vcpu * f, group: "servers", label: `Processeurs (vCPU)${suffix}` },
      { sku: skus.ram, quantity: totals.ram * f, group: "servers", label: `Mémoire vive (Gio)${suffix}` },
    ];
    if (totals.extraDisk > 0) {
      lines.push({ sku: SIZING.skus.vmiStorage, quantity: ceilSafe(totals.extraDisk * f), group: "servers", label: `Disques supplémentaires${suffix}` });
    }
    return { lines };
  }

  /* ---------- Assemblage ---------- */

  // Forfaits de support Standard pour un montant mensuel de ressources :
  // 5 % des ressources, 500 € minimum, en forfaits catalogue entiers arrondis au-dessus.
  function supportPackages(resourcesMonthly, supportItem) {
    const unit = supportItem ? Number(supportItem.publicPrice) || 0 : 0;
    if (!unit) return 1;
    const due = Math.max(SIZING.supportMinimum, positive(resourcesMonthly) * SIZING.supportRate);
    return Math.max(1, ceilSafe(due / unit));
  }

  function price(lines, bySku) {
    const missing = [];
    const priced = [];
    for (const line of lines) {
      const item = bySku.get(line.sku);
      if (!item) {
        missing.push(line.sku);
        continue;
      }
      const unitPrice = Number(item.publicPrice) || 0;
      priced.push({ ...line, unit: item.unit, unitPrice, total: unitPrice * line.quantity });
    }
    return { priced, missing };
  }

  const sum = (lines, group) => lines.filter((l) => !group || l.group === group).reduce((acc, l) => acc + l.total, 0);

  /* Estimation d'une option.
     input : { servers: [{vcpu, ram, disk, qty}], ha, backup, vmClass }
     → { ok, reason?, offer, totals, blade?, lines, serversMonthly, baseMonthly, monthly, missing } */
  function estimateOffer(offerId, input, catalog) {
    const servers = Array.isArray(input.servers) ? input.servers : [];
    const totals = totalsOf(servers);
    const offer = OFFERS.find((o) => o.id === offerId) || OFFERS[0];
    const empty = { ok: false, offer, totals, lines: [], serversMonthly: 0, baseMonthly: 0, monthly: 0, missing: [] };
    if (!totals.vms) return { ...empty, reason: "empty" };

    const bySku = new Map(catalog.map((item) => [item.sku, item]));
    const resources = offer.id === "vmi" ? vmiResourceLines(totals, input) : dedicatedResourceLines(offer.id, totals, input, catalog);
    if (resources.reason) return { ...empty, reason: resources.reason };

    const serverPart = price(resources.lines, bySku);
    const serversMonthly = sum(serverPart.priced);

    // Socle fixe de l'environnement. Support Standard : 5 % des ressources,
    // 500 € minimum, en forfaits catalogue entiers arrondis au-dessus.
    const k = SIZING.skus;
    const supportItem = bySku.get(k.support);
    const baseLines = [
      { sku: k.tenant, quantity: 1, group: "base", label: "Activation du tenant" },
      { sku: k.az, quantity: input.ha ? 2 : 1, group: "base", label: input.ha ? "Zones de disponibilité (2)" : "Zone de disponibilité" },
      { sku: k.support, quantity: supportPackages(serversMonthly, supportItem), group: "base", label: "Support Standard" },
    ];
    const basePart = price(baseLines, bySku);

    const lines = [...serverPart.priced, ...basePart.priced];
    const baseMonthly = sum(basePart.priced);
    return {
      ok: true,
      offer,
      totals,
      blade: resources.blade || null,
      lines,
      serversMonthly,
      baseMonthly,
      monthly: serversMonthly + baseMonthly,
      missing: [...serverPart.missing, ...basePart.missing],
    };
  }

  function estimateAll(input, catalog) {
    return OFFERS.map((offer) => estimateOffer(offer.id, input, catalog));
  }

  const api = {
    SIZING,
    SIZES,
    USAGES,
    VM_CLASSES,
    OFFERS,
    serverFromSize,
    serversForUsage,
    usageById,
    bladeCapacity,
    supportPackages,
    estimateOffer,
    estimateAll,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalculatorSizing = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
