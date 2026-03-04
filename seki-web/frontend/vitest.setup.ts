// Minimal browser API stubs for tests that import modules using storage/window.
const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};

// Stub window.matchMedia used by move-confirm.ts at import time.
// @ts-expect-error -- partial stub, only what's needed for module init
globalThis.window = globalThis.window ?? {};
globalThis.window.matchMedia =
  globalThis.window.matchMedia ??
  (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
