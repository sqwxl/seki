import type { Point } from "./goban/types";
import {
  ensureWasm,
  findNavButtons,
  updateNavButtons,
  renderFromEngine,
  navigateEngine,
  setupKeyboardNav,
} from "./wasm-board";

const STORAGE_KEY = "seki:analysis";

export async function analysis(_root: HTMLElement) {
  const wasm = await ensureWasm();

  const cols = 19;
  const rows = 19;
  const engine = new wasm.WasmEngine(cols, rows);

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
  const navButtons = findNavButtons("analysis-");

  function save() {
    localStorage.setItem(STORAGE_KEY, engine.moves_json());
  }

  function renderBoard() {
    const onVertexClick = (_: Event, [col, row]: Point) => {
      if (engine.try_play(col, row)) {
        save();
        renderBoard();
      }
    };

    renderFromEngine(engine, gobanEl, onVertexClick);

    if (turnEl) {
      turnEl.textContent =
        engine.current_turn_stone() === 1 ? "Black to play" : "White to play";
    }
    if (capturesEl) {
      const bc = engine.captures_black();
      const wc = engine.captures_white();
      capturesEl.textContent = `Captures: B ${bc}, W ${wc}`;
    }

    updateNavButtons(engine, navButtons);
  }

  undoBtn?.addEventListener("click", () => {
    if (engine.undo()) {
      save();
      renderBoard();
    }
  });

  passBtn?.addEventListener("click", () => {
    if (engine.pass()) {
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

  navButtons.start?.addEventListener("click", () => {
    navigateEngine(engine, "start");
    renderBoard();
  });

  navButtons.back?.addEventListener("click", () => {
    if (navigateEngine(engine, "back")) {
      renderBoard();
    }
  });

  navButtons.forward?.addEventListener("click", () => {
    if (navigateEngine(engine, "forward")) {
      renderBoard();
    }
  });

  navButtons.end?.addEventListener("click", () => {
    navigateEngine(engine, "end");
    renderBoard();
  });

  setupKeyboardNav((action) => {
    if (navigateEngine(engine, action)) {
      renderBoard();
    }
  });

  window.addEventListener("resize", () => renderBoard());

  renderBoard();
}
