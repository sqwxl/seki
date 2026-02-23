import type { UserData } from "../goban/types";

export function readUserData(): UserData | undefined {
  const el = document.getElementById("user-data");
  if (!el || !el.textContent) {
    return;
  }
  return JSON.parse(el.textContent);
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
