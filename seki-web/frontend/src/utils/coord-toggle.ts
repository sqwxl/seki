import { SHOW_COORDINATES, storage } from "./storage";

export function readShowCoordinates(): boolean {
  return storage.get(SHOW_COORDINATES) === "true";
}

export function toggleShowCoordinates(): boolean {
  const next = storage.get(SHOW_COORDINATES) !== "true";
  storage.set(SHOW_COORDINATES, String(next));

  return next;
}
