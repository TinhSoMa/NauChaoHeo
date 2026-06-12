export function createChromeMock(initialStore = {}) {
  const store = { ...initialStore };

  const storageLocal = {
    async get(keys) {
      if (!keys) return { ...store };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = store[k];
        return out;
      }
      if (typeof keys === "string") {
        return { [keys]: store[keys] };
      }
      if (typeof keys === "object") {
        const out = { ...keys };
        for (const k of Object.keys(keys)) {
          if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
        }
        return out;
      }
      return { ...store };
    },
    async set(data) {
      Object.assign(store, data || {});
    }
  };

  return {
    __store: store,
    runtime: {
      id: "test-extension-id",
      onMessage: { addListener() {} },
      getURL(p) {
        return `chrome-extension://test-extension-id/${p}`;
      }
    },
    storage: {
      local: storageLocal
    },
    tabs: {
      async query() {
        return [];
      },
      sendMessage(_tabId, _msg, cb) {
        if (cb) cb({ status: "ALIVE" });
      },
      async get() {
        throw new Error("tab not found");
      },
      async update() {}
    },
    scripting: {
      async executeScript() {}
    },
    downloads: {
      onDeterminingFilename: { addListener() {} },
      download() {}
    },
    action: { onClicked: { addListener() {} } }
  };
}

