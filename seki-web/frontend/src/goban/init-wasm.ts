import { DESKTOP_MQ } from "../utils/constants";
import type { MarkerData, Point } from "./types";

// ---------------------------------------------------------------------------
// WASM singleton
// ---------------------------------------------------------------------------

const desktopMQ = window.matchMedia(DESKTOP_MQ);

export { desktopMQ };

const koMarker: MarkerData = { type: "triangle", label: "ko" };

export { koMarker };

let wasmModule: typeof import("/static/wasm/go_engine_wasm.js") | undefined;

export async function ensureWasm(): Promise<
  typeof import("/static/wasm/go_engine_wasm.js")
> {
  if (wasmModule) {
    return wasmModule;
  }

  const wasm = await import("/static/wasm/go_engine_wasm.js");
  await wasm.default();
  wasmModule = wasm;

  return wasm;
}

export function getWasm(): typeof import("/static/wasm/go_engine_wasm.js") {
  return wasmModule!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function computeVertexSize(
  gobanEl: HTMLElement,
  cols: number,
  rows: number,
  showCoordinates?: boolean,
): number {
  const w = gobanEl.clientWidth;
  const h = gobanEl.clientHeight;

  // On desktop the goban container has a CSS height from the grid row;
  // on mobile clientHeight is stale content height, so ignore it.
  const avail = desktopMQ.matches && h > 0 ? Math.min(w, h) : w;
  const extra = 0.8;
  const coordExtra = showCoordinates ? 2 : 0;

  return Math.max(avail / (Math.max(cols, rows) + extra + coordExtra), 12);
}

export type TerritoryOverlay = {
  paintMap: (number | null)[];
  dimmedVertices: Point[];
};
