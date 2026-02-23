// ---------------------------------------------------------------------------
// Centralized localStorage keys and helpers
// ---------------------------------------------------------------------------

// Analysis page
export const ANALYSIS_SIZE = "seki:analysis:size";
export const ANALYSIS_SGF_META = "seki:analysis:sgf_meta";
export const ANALYSIS_SGF_TEXT = "seki:analysis:sgf_text";

export function analysisTreeKey(size: number): string {
  return `seki:analysis:tree:${size}`;
}

// Game settings form
export const GAME_SETTINGS = "seki:game_settings";

// Preferences
export const MOVE_CONFIRMATION = "seki:move_confirmation";
export const NOTIFICATIONS = "seki:notifications";
export const SHOW_COORDINATES = "seki:show_coordinates";
export const SHOW_MOVE_TREE = "seki:show_move_tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const storage = {
  get(key: string): string | null {
    return localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  },
  remove(key: string): void {
    localStorage.removeItem(key);
  },
  getJson<T>(key: string): T | undefined {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  },
  setJson(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  },
};
