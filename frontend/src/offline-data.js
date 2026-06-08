(function exposeOfflineData(root) {
  const CACHE_VERSION = 1;

  function isValidCachePayload(data) {
    return Boolean(
      data &&
        data.version === CACHE_VERSION &&
        data.health &&
        data.catalog &&
        Array.isArray(data.catalog.items)
    );
  }

  function chooseOfflineData(cache, snapshot) {
    if (isValidCachePayload(cache)) {
      return { source: "cache", data: cache, savedAt: cache.savedAt || "" };
    }
    if (snapshot && snapshot.health && Array.isArray(snapshot.catalog?.items)) {
      return { source: "embedded", data: snapshot, savedAt: snapshot.generatedAt || "" };
    }
    return null;
  }

  const api = { CACHE_VERSION, chooseOfflineData, isValidCachePayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalculatorOfflineData = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
