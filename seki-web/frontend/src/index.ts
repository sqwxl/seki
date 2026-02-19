import { liveGame } from "./live-game";
import { initGamesList } from "./games-list";
import { initAnalysis } from "./analysis";
import { InitialGameProps } from "./goban/types";

const gamesListRoot = document.getElementById("games-list");

if (gamesListRoot) {
  initGamesList(gamesListRoot);
}

const gameRoot = document.getElementById("game");

if (gameRoot) {
  const initialProps: InitialGameProps = JSON.parse(gameRoot.dataset.props!);
  const gameId = Number(gameRoot.dataset.gameId!);

  liveGame(initialProps, gameId);
}

const analysisRoot = document.getElementById("analysis");

if (analysisRoot) {
  initAnalysis(analysisRoot);
}
