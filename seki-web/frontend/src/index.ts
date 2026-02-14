import { go } from "./go";

const gameRoot = document.getElementById("game");

if (gameRoot) {
  go(gameRoot);
}

const analysisRoot = document.getElementById("analysis");

if (analysisRoot) {
  import("./analysis").then((m) => m.analysis(analysisRoot));
}
