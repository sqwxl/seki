import { liveGame } from "./live-game";
import { initGamesList } from "./games-list";
import { initUserGames } from "./user-games";
import { initAnalysis } from "./analysis";
import { initNotificationToggle } from "./game-notifications";
import { initNewGameForm } from "./game-settings-form";
import { renderNavStatus } from "./nav-status";
import { readUserData } from "./game-util";
import { InitialGameProps } from "./goban/types";

const navStatusEl = document.getElementById("nav-status");
const userData = readUserData();
if (navStatusEl && userData) {
  renderNavStatus(navStatusEl, userData);
}

initNotificationToggle();

const newGameRoot = document.getElementById("new-game-form");

if (newGameRoot) {
  initNewGameForm(newGameRoot);
}

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

  liveGame(initialProps, gameId, gameRoot);
}

const analysisRoot = document.getElementById("analysis");

if (analysisRoot) {
  initAnalysis(analysisRoot);
}
