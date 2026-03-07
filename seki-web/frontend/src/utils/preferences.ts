import type { UserPreferences } from "../game/types";
import { readUserData } from "../game/util";
import {
  showCoordinates,
  showMoveTree,
  moveConfirmEnabled,
} from "../game/state";
import { readMoveConfirmation } from "./move-confirm";
import {
  storage,
  THEME,
  MOVE_CONFIRMATION,
  SHOW_COORDINATES,
  SHOW_MOVE_TREE,
  NOTIFICATIONS,
} from "./storage";

let serverPrefs: UserPreferences = {};

/**
 * Initialize preferences from the server-provided UserData.
 * Merges server prefs into localStorage (server wins on conflict),
 * then refreshes signals so components see the correct initial values.
 */
export function initPreferences(): void {
  const userData = readUserData();
  if (!userData) {
    return;
  }

  serverPrefs = userData.preferences ?? {};

  // Server prefs take precedence — write them into localStorage
  if (serverPrefs.theme != null) {
    storage.set(THEME, serverPrefs.theme);
  }
  if (serverPrefs.move_confirmation != null) {
    storage.set(MOVE_CONFIRMATION, String(serverPrefs.move_confirmation));
  }
  if (serverPrefs.show_coordinates != null) {
    storage.set(SHOW_COORDINATES, String(serverPrefs.show_coordinates));
  }
  if (serverPrefs.show_move_tree != null) {
    storage.set(SHOW_MOVE_TREE, String(serverPrefs.show_move_tree));
  }
  if (serverPrefs.notifications != null) {
    storage.set(NOTIFICATIONS, serverPrefs.notifications);
  }

  // Refresh signals from updated localStorage
  showCoordinates.value = storage.get(SHOW_COORDINATES) === "true";
  showMoveTree.value = storage.get(SHOW_MOVE_TREE) === "true";
  moveConfirmEnabled.value = readMoveConfirmation();
}

/**
 * Save a preference both to localStorage and to the server.
 * localStorage is updated immediately for responsiveness;
 * the server call is fire-and-forget.
 */
export function savePref(
  key: keyof UserPreferences,
  value: string | boolean,
): void {
  serverPrefs[key] = value as never;
  fetch("/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {
    // Silently fail — localStorage is the fallback
  });
}
