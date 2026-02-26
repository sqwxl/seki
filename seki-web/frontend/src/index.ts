import { liveGame } from "./layouts/live-game";
import { initGamesList } from "./layouts/games-list";
import { initUserGames } from "./layouts/user-games";
import { initAnalysis } from "./layouts/analysis";
import { initUnreadTracking } from "./game/unread";
import { initNotificationBell } from "./components/notification-bell";
import { initNewGameForm } from "./layouts/game-settings-form";
import type { InitialGameProps } from "./game/types";
import { parseDatasetJson } from "./utils/format";
import { initThemeToggle } from "./utils/theme";
import { initFormValidation } from "./utils/form-validation";
import { ensureConnected } from "./ws";

// Connect WS on every page for global presence tracking
ensureConnected();

initThemeToggle();
initFormValidation();
initUnreadTracking();
initNotificationBell();

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
  const initialProps = parseDatasetJson<InitialGameProps>(gameRoot, "props");
  const gameId = Number(gameRoot.dataset.gameId);

  if (initialProps && !isNaN(gameId)) {
    liveGame(initialProps, gameId, gameRoot);
  }
}

const analysisRoot = document.getElementById("analysis");

if (analysisRoot) {
  initAnalysis(analysisRoot);
}
