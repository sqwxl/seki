import { liveGame } from "./live-game";
import { initGamesList } from "./games-list";
import { initAnalysis } from "./analysis";

const gamesListRoot = document.getElementById("games-list");
if (gamesListRoot) {
  initGamesList(gamesListRoot);
}

const gameRoot = document.getElementById("game");
if (gameRoot) {
  liveGame(gameRoot);
}

const analysisRoot = document.getElementById("analysis");
if (analysisRoot) {
  initAnalysis(analysisRoot);
}
