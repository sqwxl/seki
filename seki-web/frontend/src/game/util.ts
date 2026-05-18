import { USER_DATA, storage } from "../utils/storage";
import type { UserData } from "./types";

declare global {
  interface Window {
    __sekiUserData?: UserData;
  }
}

export function readUserData(): UserData | undefined {
  if (window.__sekiUserData) {
    return window.__sekiUserData;
  }

  const stored = storage.getJson<UserData>(USER_DATA);

  if (stored?.id) {
    window.__sekiUserData = stored;

    return stored;
  }

  const el = document.getElementById("user-data");

  if (!el || !el.textContent) {
    return;
  }

  const userData = JSON.parse(el.textContent) as UserData;

  window.__sekiUserData = userData;

  return userData;
}

export function writeUserData(userData: UserData | undefined): void {
  window.__sekiUserData = userData;

  if (userData) {
    storage.setJson(USER_DATA, userData);
  } else {
    storage.remove(USER_DATA);
  }

  const el = document.getElementById("user-data");

  if (el) {
    el.textContent = JSON.stringify(userData ?? {});
  }
}

export function derivePlayerStone(
  userData: UserData | undefined,
  black: UserData | null,
  white: UserData | null,
): number {
  if (!userData) {
    return 0;
  }

  if (black && black.id === userData.id) {
    return 1;
  }

  if (white && white.id === userData.id) {
    return -1;
  }

  return 0;
}
