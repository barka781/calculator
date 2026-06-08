const test = require("node:test");
const assert = require("node:assert/strict");

const { CACHE_VERSION, chooseOfflineData, isValidCachePayload } = require("../src/offline-data.js");

test("valid cache wins over embedded snapshot", () => {
  const cache = {
    version: CACHE_VERSION,
    savedAt: "2026-06-08T09:00:00.000Z",
    health: { status: "ok" },
    catalog: { items: [{ sku: "cache-sku" }] },
  };
  const snapshot = {
    generatedAt: "2026-06-01T09:00:00.000Z",
    health: { status: "ok" },
    catalog: { items: [{ sku: "snapshot-sku" }] },
  };

  const choice = chooseOfflineData(cache, snapshot);

  assert.equal(isValidCachePayload(cache), true);
  assert.equal(choice.source, "cache");
  assert.equal(choice.data.catalog.items[0].sku, "cache-sku");
  assert.equal(choice.savedAt, cache.savedAt);
});

test("cache without current version is rejected and snapshot is used", () => {
  const staleCache = {
    savedAt: "2026-06-08T09:00:00.000Z",
    health: { status: "ok" },
    catalog: { items: [{ sku: "old-cache-sku" }] },
  };
  const snapshot = {
    generatedAt: "2026-06-01T09:00:00.000Z",
    health: { status: "ok" },
    catalog: { items: [{ sku: "snapshot-sku" }] },
  };

  const choice = chooseOfflineData(staleCache, snapshot);

  assert.equal(isValidCachePayload(staleCache), false);
  assert.equal(choice.source, "embedded");
  assert.equal(choice.data.catalog.items[0].sku, "snapshot-sku");
  assert.equal(choice.savedAt, snapshot.generatedAt);
});
