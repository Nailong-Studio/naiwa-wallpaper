// 统一存储适配层：扩展环境用 chrome.storage，本地预览时降级到 localStorage
const store = (() => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return {
      async get(key) {
        const obj = await chrome.storage.local.get(key);
        return obj[key];
      },
      async set(entries) {
        return chrome.storage.local.set(entries);
      }
    };
  }
  return {
    async get(key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === 'undefined') return undefined;
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(entries) {
      for (const [k, v] of Object.entries(entries)) {
        if (v === undefined) continue;
        localStorage.setItem(k, JSON.stringify(v));
      }
    }
  };
})();
