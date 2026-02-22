import { liveGame } from "./live-game";
import { initGamesList } from "./games-list";
import { initUserGames } from "./user-games";
import { initAnalysis } from "./analysis";
import { initNotificationToggle } from "./game-notifications";
import { InitialGameProps } from "./goban/types";

initNotificationToggle();

const gamesListRoot = document.getElementById("games-list");

if (gamesListRoot) {
  initGamesList(gamesListRoot);
}

const userGamesRoot = document.getElementById("user-games");

if (userGamesRoot) {
  initUserGames(userGamesRoot);
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
