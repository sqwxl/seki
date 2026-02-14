import { render } from "preact";
import { Goban } from "./goban/index";
import type { MarkerData, Point } from "./goban/types";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

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

export type NavButtons = {
  start: HTMLButtonElement | null;
  back: HTMLButtonElement | null;
  forward: HTMLButtonElement | null;
  end: HTMLButtonElement | null;
  counter: HTMLElement | null;
};

export function findNavButtons(prefix: string): NavButtons {
  return {
    start: document.getElementById(`${prefix}start-btn`) as HTMLButtonElement | null,
    back: document.getElementById(`${prefix}back-btn`) as HTMLButtonElement | null,
    forward: document.getElementById(`${prefix}forward-btn`) as HTMLButtonElement | null,
    end: document.getElementById(`${prefix}end-btn`) as HTMLButtonElement | null,
    counter: document.getElementById(`${prefix}move-counter`),
  };
}

export function updateNavButtons(engine: WasmEngine, buttons: NavButtons): void {
  const atStart = engine.is_at_start();
  const atLatest = engine.is_at_latest();

  if (buttons.start) { buttons.start.disabled = atStart; }
  if (buttons.back) { buttons.back.disabled = atStart; }
  if (buttons.forward) { buttons.forward.disabled = atLatest; }
  if (buttons.end) { buttons.end.disabled = atLatest; }
  if (buttons.counter) {
    buttons.counter.textContent = `Move ${engine.view_index()} / ${engine.total_moves()}`;
  }
}

export function computeVertexSize(
  gobanEl: HTMLElement,
  cols: number,
  rows: number,
): number {
  const avail = gobanEl.clientWidth;
  const extra = 0.8;
  return Math.max(avail / (Math.max(cols, rows) + extra), 12);
}

export function renderFromEngine(
  engine: WasmEngine,
  gobanEl: HTMLElement,
  onVertexClick?: (evt: Event, position: Point) => void,
): void {
  const board = [...engine.board()] as number[];
  const cols = engine.cols();
  const rows = engine.rows();
  const markerMap: (MarkerData | null)[] = Array(board.length).fill(null);

  if (engine.has_ko()) {
    const kc = engine.ko_col();
    const kr = engine.ko_row();
    markerMap[kr * cols + kc] = koMarker;
  }

  render(
    <Goban
      cols={cols}
      rows={rows}
      vertexSize={computeVertexSize(gobanEl, cols, rows)}
      signMap={board}
      markerMap={markerMap}
      fuzzyStonePlacement
      animateStonePlacement
      onVertexClick={onVertexClick}
    />,
    gobanEl,
  );
}

export type NavAction = "back" | "forward" | "start" | "end";

export function navigateEngine(engine: WasmEngine, action: NavAction): boolean {
  switch (action) {
    case "back":
      return engine.back();
    case "forward":
      return engine.forward();
    case "start":
      engine.to_start();
      return true;
    case "end":
      engine.to_latest();
      return true;
  }
}

export function setupKeyboardNav(
  navigate: (action: NavAction) => void,
  onEscape?: () => void,
): () => void {
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        navigate("back");
        break;
      case "ArrowRight":
        e.preventDefault();
        navigate("forward");
        break;
      case "Home":
        e.preventDefault();
        navigate("start");
        break;
      case "End":
        e.preventDefault();
        navigate("end");
        break;
      case "Escape":
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        break;
    }
  };

  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
