import { go } from "./go";
import { createBoard, findNavButtons } from "./wasm-board";

const gameRoot = document.getElementById("game");

if (gameRoot) {
  go(gameRoot);
}

const analysisRoot = document.getElementById("analysis");

if (analysisRoot) {
  const gobanEl = document.getElementById("goban")!;
  const turnEl = document.getElementById("analysis-turn");
  const capturesEl = document.getElementById("analysis-captures");

  createBoard({
    cols: 19,
    rows: 19,
    gobanEl,
    storageKey: "seki:analysis",
    navButtons: findNavButtons(),
    buttons: {
      pass: document.getElementById("pass-btn") as HTMLButtonElement | null,
    },
    onRender: (engine) => {
      if (turnEl) {
        turnEl.textContent =
          engine.current_turn_stone() === 1 ? "Black to play" : "White to play";
      }
      if (capturesEl) {
        capturesEl.textContent = `Captures: B ${engine.captures_black()}, W ${engine.captures_white()}`;
      }
    },
  });
}
