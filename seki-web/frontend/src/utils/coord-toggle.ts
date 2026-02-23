const COORDS_KEY = "seki:show_coordinates";

export function readShowCoordinates(): boolean {
  return localStorage.getItem(COORDS_KEY) === "true";
}

export function toggleShowCoordinates(): boolean {
  const next = localStorage.getItem(COORDS_KEY) !== "true";
  localStorage.setItem(COORDS_KEY, String(next));
  return next;
}
