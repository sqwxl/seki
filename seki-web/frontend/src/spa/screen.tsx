import type { UserData } from "../game/types";
import {
AuthFormScreen,
NotFoundScreen,
SettingsRedirect,
} from "./auth-screens";
import {
AnalysisScreen,
ChallengeScreen,
GameScreenRoute,
GamesScreen,
NewGameScreen,
} from "./game-screens";
import { ProfileScreen } from "./profile-screen";
import type { NavigateFn,Route } from "./types";

export function Screen({
  route,
  currentUser,
  navigate,
  refreshSession,
}: {
  route: Route;
  currentUser: UserData | undefined;
  navigate: NavigateFn;
  refreshSession: () => Promise<void>;
}) {
  switch (route.kind) {
    case "games":
      return <GamesScreen />;
    case "new-game":
      return <NewGameScreen navigate={navigate} />;
    case "challenge":
      return <ChallengeScreen username={route.username} navigate={navigate} />;
    case "game":
      return <GameScreenRoute route={route} navigate={navigate} />;
    case "analysis":
      return <AnalysisScreen />;
    case "profile":
      return (
        <ProfileScreen
          username={route.username}
          navigate={navigate}
          refreshSession={refreshSession}
        />
      );
    case "login":
      return (
        <AuthFormScreen
          mode="login"
          currentUser={currentUser}
          navigate={navigate}
          refreshSession={refreshSession}
          redirectTarget={route.redirect}
        />
      );
    case "register":
      return (
        <AuthFormScreen
          mode="register"
          currentUser={currentUser}
          navigate={navigate}
          refreshSession={refreshSession}
        />
      );
    case "settings":
      return <SettingsRedirect currentUser={currentUser} navigate={navigate} />;
    default:
      return <NotFoundScreen />;
  }
}
