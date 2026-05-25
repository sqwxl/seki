import { signal } from "@preact/signals";
import { moveConfirmEnabled, showCoordinates } from "../game/state";
import type { UserPreferences } from "../game/types";
import { readUserData } from "../game/util";
import { readMoveConfirmation } from "./move-confirm";
import { parseRatingDisplayMode, type RatingDisplayMode } from "./rating";
import {
  MOVE_CONFIRMATION,
  NOTIFICATIONS,
  RATING_DISPLAY,
  SHOW_COORDINATES,
  storage,
  THEME,
} from "./storage";

let serverPrefs: UserPreferences = {};

function storedRatingDisplayPreference(): RatingDisplayMode {
  return parseRatingDisplayMode(
    storage.get(RATING_DISPLAY) ?? serverPrefs.rating_display,
  );
}

export const ratingDisplayPreference = signal<RatingDisplayMode>(
  storedRatingDisplayPreference(),
);

export function readRatingDisplayPreference(): RatingDisplayMode {
  return storedRatingDisplayPreference();
}

/**
 * Initialize preferences from the server-provided UserData.
 * Merges server prefs into localStorage (server wins on conflict),
 * then refreshes signals so components see the correct initial values.
 */
export function initPreferences(): void {
  const userData = readUserData();
  serverPrefs = {};

  if (!userData) {
    ratingDisplayPreference.value = readRatingDisplayPreference();

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

  if (serverPrefs.notifications != null) {
    storage.set(NOTIFICATIONS, serverPrefs.notifications);
  }

  if (serverPrefs.rating_display != null) {
    storage.set(
      RATING_DISPLAY,
      parseRatingDisplayMode(serverPrefs.rating_display),
    );
  }

  ratingDisplayPreference.value = readRatingDisplayPreference();

  // Refresh signals from updated localStorage
  showCoordinates.value = storage.get(SHOW_COORDINATES) === "true";
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

  if (key === "rating_display") {
    const next = parseRatingDisplayMode(value);
    storage.set(RATING_DISPLAY, next);
    ratingDisplayPreference.value = next;
  }

  fetch("/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {
    // Silently fail — localStorage is the fallback
  });
}
