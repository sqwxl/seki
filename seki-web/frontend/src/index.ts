import { liveGame } from "./layouts/live-game";
import { initGamesList } from "./layouts/games-list";
import { initUserGames } from "./layouts/user-games";
import { initAnalysis } from "./layouts/analysis";
import { initNotificationToggle } from "./game/notifications";
import { initNewGameForm } from "./layouts/game-settings-form";
import { readUserData } from "./game/util";
import { InitialGameProps } from "./goban/types";

const userData = readUserData();

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
