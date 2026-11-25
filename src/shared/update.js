(() => {
  const releases = 'https://github.com/NourZohdy/cinnamon-boost/releases/';
  const version = /^\d+(\.\d+){0,3}$/;

  function isNewer(latest, current) {
    if (typeof latest !== 'string' || typeof current !== 'string' || !version.test(latest) || !version.test(current)) return false;
    const a = latest.split('.'), b = current.split('.');
    for (let i = 0; i < 4; i++) {
      const diff = BigInt(a[i] ?? 0) - BigInt(b[i] ?? 0);
      if (diff !== 0n) return diff > 0n;
    }
    return false;
  }

  function releaseUrl(url) {
    if (typeof url === 'string' && url.startsWith(releases)) {
      try {
        const href = new URL(url).href;
        if (href.startsWith(releases)) return href;
      } catch (_) {}
    }
    return releases + 'latest';
  }

  const api = { UPDATE_KEY: 'cinnamonBoost.update', isNewer, releaseUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    globalThis.CinnamonBoost = globalThis.CinnamonBoost || {};
    globalThis.CinnamonBoost.update = api;
  }
})();
