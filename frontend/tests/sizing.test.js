const test = require("node:test");
const assert = require("node:assert/strict");

const { estimateOffer, estimateAll, serversForUsage, supportPackages, SIZING } = require("../src/sizing.js");

// Extrait du catalogue réel (prix publics, specs des lames) au 2026-10-03.
const blade = (sku, name, threads, ram, price, extra = {}) => ({
  sku, name, unit: "Lame", publicPrice: price, specs: { threads, ram, ...extra },
});
const unitItem = (sku, unit, price) => ({ sku, name: sku, unit, publicPrice: price, specs: {} });

const CATALOG = [
  blade("csp:fr1:iaas:openiaas:eco:v3", "OPENIAAS:V3:ECO", 40, 384, 1357.62),
  blade("csp:fr1:iaas:openiaas:standard:v3", "OPENIAAS:V3:STD", 64, 384, 1500.48),
  blade("csp:fr1:iaas:openiaas:advance:v3", "OPENIAAS:V3:ADV", 96, 768, 2328.94),
  blade("csp:fr1:iaas:vmware:standard:v3", "VMWARE:V3:STD", 64, 384, 3806.83),
  // Lames à écarter : GPU, et prix non publié (0).
  blade("csp:fr1:iaas:vmware:perf4:v3", "VMWARE:V3:PERF4", 64, 512, 0, { gpu: { count: 2 } }),
  blade("csp:fr1:iaas:openiaas:gpu:test", "OPENIAAS:GPU", 512, 4096, 10, { gpu: { count: 8 } }),
  unitItem("csp:tenant:v1", "Tenant", 184.8),
  unitItem("csp:fr1:iaas:az:v1", "AZ par tenant", 151.2),
  unitItem("csp:support:standard", "Jour ouvré", 500),
  unitItem("csp:fr1:iaas:storage:bloc:medium:v1", "Gio", 0.0756),
  unitItem("csp:fr1:iaas:backup:vm:v1", "vm", 12),
  unitItem("csp:fr1:iaas:storage:backup:v1", "Tio", 23.94),
  unitItem("csp:fr1:iaas:vmi:dev:vcpu:v1", "vCPU", 11.03),
  unitItem("csp:fr1:iaas:vmi:dev:ram:v1", "Gio RAM", 2.88),
  unitItem("csp:fr1:iaas:vmi:gp:vcpu:v1", "vCPU", 13.98),
  unitItem("csp:fr1:iaas:vmi:gp:ram:v1", "Gio RAM", 3.58),
  unitItem("csp:fr1:iaas:vmi:storage:standard:v1", "Gio", 0.2077),
];

const BASE_MIN = 184.8 + 151.2 + 500; // tenant + 1 zone + support minimum
const qtyOf = (est, sku) => est.lines.find((l) => l.sku === sku)?.quantity;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test("no server: every offer reports an empty estimate", () => {
  for (const est of estimateAll({ servers: [] }, CATALOG)) {
    assert.equal(est.ok, false);
    assert.equal(est.reason, "empty");
  }
});

test("VM Instances: resources priced per vCPU and GiB, system disk included up to 50 GB", () => {
  const est = estimateOffer("vmi", { servers: [{ vcpu: 4, ram: 16, disk: 100, qty: 2 }], vmClass: "gp" }, CATALOG);
  assert.equal(est.ok, true);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:gp:vcpu:v1"), 8);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:gp:ram:v1"), 32);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:storage:standard:v1"), 100); // 2 × (100 − 50)
  near(est.serversMonthly, 8 * 13.98 + 32 * 3.58 + 100 * 0.2077);
  // Ressources ≈ 247 € : 5 % < 500 € → support au minimum.
  near(est.baseMonthly, BASE_MIN);
  near(est.monthly, est.serversMonthly + BASE_MIN);
});

test("VM Instances: the class selects its own SKUs, and small disks add no storage line", () => {
  const est = estimateOffer("vmi", { servers: [{ vcpu: 2, ram: 4, disk: 50, qty: 1 }], vmClass: "dev" }, CATALOG);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:dev:vcpu:v1"), 2);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:dev:ram:v1"), 4);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:storage:standard:v1"), undefined);
  assert.equal(qtyOf(est, "csp:fr1:iaas:vmi:gp:vcpu:v1"), undefined);
});

test("support packages: 500 € minimum, then 5 % of resources rounded up to whole packages", () => {
  const support = { sku: "csp:support:standard", publicPrice: 500 };
  assert.equal(supportPackages(0, support), 1);
  assert.equal(supportPackages(10000, support), 1); // 5 % = 500 €
  assert.equal(supportPackages(10000.01, support), 2);
  assert.equal(supportPackages(25000, support), 3); // 1 250 € → 3 forfaits
});

test("support grows to 5 % of resources, in whole 500 € packages rounded up", () => {
  // 400 vCPU + 1 600 GiB en General Purpose : 11 320 € → 5 % = 566 € → 2 forfaits.
  const est = estimateOffer("vmi", { servers: [{ vcpu: 16, ram: 64, disk: 50, qty: 25 }], vmClass: "gp" }, CATALOG);
  near(est.serversMonthly, 400 * 13.98 + 1600 * 3.58);
  assert.equal(qtyOf(est, "csp:support:standard"), 2);
  near(est.baseMonthly, 184.8 + 151.2 + 2 * 500);
  // Juste sous le seuil (5 % ≤ 500 €) : un seul forfait.
  const small = estimateOffer("vmi", { servers: [{ vcpu: 16, ram: 64, disk: 50, qty: 10 }], vmClass: "gp" }, CATALOG);
  assert.equal(qtyOf(small, "csp:support:standard"), 1);
});

test("dedicated: picks the cheapest blade model that covers the need", () => {
  // 700 Gio de RAM : ECO et STD offrent 345,6 Gio utiles → 3 lames ; ADV 691,2 → 2 lames.
  // 3 × ECO = 4 072,86 € < 3 × STD = 4 501,44 € < 2 × ADV = 4 657,88 €.
  const est = estimateOffer("openiaas", { servers: [{ vcpu: 4, ram: 70, disk: 100, qty: 10 }] }, CATALOG);
  assert.equal(est.blade.item.sku, "csp:fr1:iaas:openiaas:eco:v3");
  assert.equal(est.blade.count, 3);
  assert.equal(qtyOf(est, "csp:fr1:iaas:storage:bloc:medium:v1"), 1100); // 1 000 Go + 10 %
});

test("storage margin is not inflated by floating-point error (350 Go × 1,1 = 385 Go)", () => {
  // Préréglage « Application métier » : 100 + 250 Go de disques.
  const est = estimateOffer("openiaas", { servers: serversForUsage("business-app") }, CATALOG);
  assert.equal(qtyOf(est, "csp:fr1:iaas:storage:bloc:medium:v1"), 385);
});

test("RAM filling exactly three blades needs three blades, not four", () => {
  // 12 × 86,4 Gio = 1 036,8 Gio = 3 × 345,6 Gio utiles par lame ECO. En virgule
  // flottante : 1 036,8000000000002 / 345,6 = 3,0000000000000004, qu'un Math.ceil
  // naïf arrondit à 4. Seul le modèle ECO est proposé pour isoler ce calcul.
  const ecoOnly = CATALOG.filter((i) => !/:openiaas:(standard|advance|gpu)/.test(i.sku));
  const est = estimateOffer("openiaas", { servers: [{ vcpu: 1, ram: 86.4, disk: 50, qty: 12 }] }, ecoOnly);
  assert.equal(est.blade.item.sku, "csp:fr1:iaas:openiaas:eco:v3");
  assert.equal(est.blade.count, 3);
});

test("dedicated: blades are counted by actually placing the VMs, not by summing resources", () => {
  // 5 VM de 45 vCPU = 225 vCPU : la somme tiendrait sur 2 lames STD (2 × 128), mais
  // une STD n'accueille que 2 de ces VM (3 × 45 = 135 > 128) → 3 STD = 4 501,44 €.
  // Alternatives : 5 ECO (80 vCPU, 1 VM chacune) = 6 788,10 € ; 2 ADV (192 vCPU,
  // 4 VM chacune) = 4 657,88 €. La moins chère qui range réellement : 3 STD.
  const est = estimateOffer("openiaas", { servers: [{ vcpu: 45, ram: 8, disk: 50, qty: 5 }] }, CATALOG);
  assert.equal(est.blade.item.sku, "csp:fr1:iaas:openiaas:standard:v3");
  assert.equal(est.blade.count, 3);
});

test("bulk placement matches a naive one-by-one first-fit on random configurations", () => {
  // Référence volontairement naïve : chaque serveur placé un par un, du plus gros
  // au plus petit, dans la première lame qui a la place (vCPU et RAM).
  const capVcpu = 64 * SIZING.vcpuPerThread;
  const capRam = 384 * SIZING.ramUsableRatio;
  const naive = (servers) => {
    const vms = [];
    for (const s of servers) for (let i = 0; i < s.qty; i += 1) vms.push(s);
    const w = (v) => Math.max(v.vcpu / capVcpu, v.ram / capRam);
    vms.sort((a, b) => w(b) - w(a));
    const bins = [];
    for (const v of vms) {
      const bin = bins.find((b) => b.vcpu + v.vcpu <= capVcpu + 1e-9 && b.ram + v.ram <= capRam + 1e-9);
      if (bin) { bin.vcpu += v.vcpu; bin.ram += v.ram; } else bins.push({ vcpu: v.vcpu, ram: v.ram });
    }
    return Math.max(bins.length, 1);
  };
  const stdOnly = CATALOG.filter((i) => !/:openiaas:(eco|advance|gpu)/.test(i.sku));
  let seed = 42; // générateur pseudo-aléatoire à graine fixe : test reproductible
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 300; run += 1) {
    const servers = Array.from({ length: 1 + rand(6) }, () => ({
      vcpu: 1 + rand(80), ram: 1 + rand(200), disk: 50, qty: 1 + rand(12),
    }));
    const est = estimateOffer("openiaas", { servers }, stdOnly);
    assert.equal(est.blade.count, naive(servers), JSON.stringify(servers));
  }
});

test("dedicated: a VM must fit on a single blade", () => {
  // 100 vCPU dépasse une lame ECO (80 vCPU) mais tient sur une STD (128).
  const est = estimateOffer("openiaas", { servers: [{ vcpu: 100, ram: 64, disk: 50, qty: 1 }] }, CATALOG);
  assert.equal(est.blade.item.sku, "csp:fr1:iaas:openiaas:standard:v3");
  assert.equal(est.blade.count, 1);
});

test("dedicated: a VM larger than any blade is refused, while VM Instances still prices it", () => {
  const input = { servers: [{ vcpu: 300, ram: 64, disk: 50, qty: 1 }], vmClass: "gp" };
  const dedicated = estimateOffer("openiaas", input, CATALOG);
  assert.equal(dedicated.ok, false);
  assert.equal(dedicated.reason, "too_big");
  assert.equal(estimateOffer("vmi", input, CATALOG).ok, true);
});

test("GPU blades and blades without a published price are never chosen", () => {
  // Besoin énorme : seule la lame GPU (prix dérisoire) pourrait le couvrir en une fois.
  const est = estimateOffer("vmware", { servers: [{ vcpu: 8, ram: 32, disk: 50, qty: 30 }] }, CATALOG);
  assert.equal(est.blade.item.sku, "csp:fr1:iaas:vmware:standard:v3");
  const oiaas = estimateOffer("openiaas", { servers: [{ vcpu: 8, ram: 32, disk: 50, qty: 30 }] }, CATALOG);
  assert.notEqual(oiaas.blade.item.sku, "csp:fr1:iaas:openiaas:gpu:test");
});

test("VM Instances in high availability double every server in a second zone", () => {
  const input = { servers: [{ vcpu: 4, ram: 16, disk: 100, qty: 1 }], vmClass: "gp" };
  const single = estimateOffer("vmi", input, CATALOG);
  const ha = estimateOffer("vmi", { ...input, ha: true }, CATALOG);
  assert.equal(qtyOf(ha, "csp:fr1:iaas:vmi:gp:vcpu:v1"), 8);
  assert.equal(qtyOf(ha, "csp:fr1:iaas:vmi:gp:ram:v1"), 32);
  assert.equal(qtyOf(ha, "csp:fr1:iaas:vmi:storage:standard:v1"), 100); // 2 × (100 − 50)
  near(ha.serversMonthly, 2 * single.serversMonthly);
  assert.equal(qtyOf(ha, "csp:fr1:iaas:az:v1"), 2);
});

test("high availability adds a spare blade (at least 2) and a second zone", () => {
  const small = { servers: [{ vcpu: 2, ram: 4, disk: 50, qty: 1 }] };
  assert.equal(estimateOffer("openiaas", small, CATALOG).blade.count, 1);
  const ha = estimateOffer("openiaas", { ...small, ha: true }, CATALOG);
  assert.equal(ha.blade.count, 2);
  assert.equal(qtyOf(ha, "csp:fr1:iaas:az:v1"), 2);
  near(ha.baseMonthly, 184.8 + 2 * 151.2 + 500);
});

test("backup option adds VM backup and backup storage to dedicated offers only", () => {
  const input = { servers: [{ vcpu: 4, ram: 16, disk: 100, qty: 2 }], backup: true, vmClass: "gp" };
  const dedicated = estimateOffer("openiaas", input, CATALOG);
  assert.equal(qtyOf(dedicated, "csp:fr1:iaas:backup:vm:v1"), 2);
  assert.equal(qtyOf(dedicated, "csp:fr1:iaas:storage:backup:v1"), 1); // 300 Go / 1 024 → 0,29 Tio → 1 Tio
  const vmi = estimateOffer("vmi", input, CATALOG);
  assert.equal(qtyOf(vmi, "csp:fr1:iaas:backup:vm:v1"), undefined);
});

test("a SKU missing from the catalog is reported instead of silently priced at zero", () => {
  const catalog = CATALOG.filter((i) => i.sku !== "csp:tenant:v1");
  const est = estimateOffer("vmi", { servers: [{ vcpu: 2, ram: 4, disk: 50, qty: 1 }] }, catalog);
  assert.deepEqual(est.missing, ["csp:tenant:v1"]);
});

test("every estimate line has a whole quantity, as the quote cart requires", () => {
  const input = { servers: [{ vcpu: 3, ram: 7, disk: 333, qty: 3 }], backup: true, ha: true, vmClass: "gp" };
  for (const est of estimateAll(input, CATALOG)) {
    for (const line of est.lines) assert.ok(Number.isInteger(line.quantity) && line.quantity >= 1, `${line.sku}: ${line.quantity}`);
  }
});

test("usage presets produce ready-to-price servers", () => {
  const servers = serversForUsage("business-app");
  assert.equal(servers.length, 2);
  for (const est of estimateAll({ servers, vmClass: "gp" }, CATALOG)) assert.equal(est.ok, true);
  assert.equal(SIZING.vcpuPerThread, 2); // hypothèse documentée, à valider avec l'avant-vente
});
