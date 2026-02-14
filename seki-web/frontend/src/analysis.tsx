import { render } from "preact";
import { Goban } from "./goban/index";
import type { MarkerData, Point } from "./goban/types";

const koMarker: MarkerData = { type: "triangle", label: "ko" };
const STORAGE_KEY = "seki:analysis";

export async function analysis(root: HTMLElement) {
  const wasm = await import("/static/wasm/go_engine_wasm.js");
  await wasm.default();

  const cols = 19;
  const rows = 19;
  const engine = new wasm.WasmEngine(cols, rows);

  // Restore saved moves
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    engine.replace_moves(saved);
    engine.to_latest();
  }

  const gobanEl = document.getElementById("goban")!;
  const turnEl = document.getElementById("analysis-turn");
  const capturesEl = document.getElementById("analysis-captures");
  const undoBtn = document.getElementById("analysis-undo-btn") as HTMLButtonElement | null;
  const passBtn = document.getElementById("analysis-pass-btn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("analysis-reset-btn") as HTMLButtonElement | null;
  const startBtn = document.getElementById("analysis-start-btn") as HTMLButtonElement | null;
  const backBtn = document.getElementById("analysis-back-btn") as HTMLButtonElement | null;
  const forwardBtn = document.getElementById("analysis-forward-btn") as HTMLButtonElement | null;
  const endBtn = document.getElementById("analysis-end-btn") as HTMLButtonElement | null;
  const moveCounter = document.getElementById("analysis-move-counter");

  function save() {
    localStorage.setItem(STORAGE_KEY, engine.moves_json());
  }

  function vertexSize(): number {
    const avail = gobanEl.clientWidth;
    const extra = 0.8;
    return Math.max(avail / (Math.max(cols, rows) + extra), 12);
  }

  function updateNavButtons() {
    const atStart = engine.is_at_start();
    const atLatest = engine.is_at_latest();

    if (startBtn) { startBtn.disabled = atStart; }
    if (backBtn) { backBtn.disabled = atStart; }
    if (forwardBtn) { forwardBtn.disabled = atLatest; }
    if (endBtn) { endBtn.disabled = atLatest; }

    if (moveCounter) {
      moveCounter.textContent = `Move ${engine.view_index()} / ${engine.total_moves()}`;
    }
  }

  function renderBoard() {
    const board = [...engine.board()] as number[];
    const markerMap: (MarkerData | null)[] = Array(board.length).fill(null);

    if (engine.has_ko()) {
      const kc = engine.ko_col();
      const kr = engine.ko_row();
      markerMap[kr * cols + kc] = koMarker;
    }

    const atLatest = engine.is_at_latest();

    const onVertexClick = atLatest
      ? (_: Event, [col, row]: Point) => {
          if (engine.try_play(col, row)) {
            save();
            renderBoard();
          }
        }
      : undefined;

    render(
      <Goban
        cols={cols}
        rows={rows}
        vertexSize={vertexSize()}
        signMap={board}
        markerMap={markerMap}
        fuzzyStonePlacement
        animateStonePlacement
        onVertexClick={onVertexClick}
      />,
      gobanEl,
    );

    if (turnEl) {
      turnEl.textContent =
        engine.current_turn_stone() === 1 ? "Black to play" : "White to play";
    }
    if (capturesEl) {
      const bc = engine.captures_black();
      const wc = engine.captures_white();
      capturesEl.textContent = `Captures: B ${bc}, W ${wc}`;
    }

    updateNavButtons();
  }

  undoBtn?.addEventListener("click", () => {
    if (engine.undo()) {
      save();
      renderBoard();
    }
  });

  passBtn?.addEventListener("click", () => {
    if (engine.is_at_latest() && engine.pass()) {
      save();
      renderBoard();
    }
  });

  resetBtn?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    engine.replace_moves("[]");
    engine.to_latest();
    renderBoard();
  });

  startBtn?.addEventListener("click", () => {
    engine.to_start();
    renderBoard();
  });

  backBtn?.addEventListener("click", () => {
    if (engine.back()) {
      renderBoard();
    }
  });

  forwardBtn?.addEventListener("click", () => {
    if (engine.forward()) {
      renderBoard();
    }
  });

  endBtn?.addEventListener("click", () => {
    engine.to_latest();
    renderBoard();
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        if (engine.back()) { renderBoard(); }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (engine.forward()) { renderBoard(); }
        break;
      case "Home":
        e.preventDefault();
        engine.to_start();
        renderBoard();
        break;
      case "End":
        e.preventDefault();
        engine.to_latest();
        renderBoard();
        break;
    }
  });

  window.addEventListener("resize", () => renderBoard());

  renderBoard();
}
