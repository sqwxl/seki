import { useEffect } from "preact/hooks";
import type { UserData } from "../game/types";
import { setFlash } from "../utils/flash";
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
  SpectateScreen,
} from "./game-screens";
import { ProfileScreen } from "./profile-screen";
import type { NavigateFn, Route } from "./types";

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
  useEffect(() => {
    if (!currentUser?.is_bot) {
      return;
    }

    const displayName = currentUser.display_name;
    const profileRoute = `/users/${encodeURIComponent(displayName)}`;

    switch (route.kind) {
      case "games":
      case "spectate":
      case "new-game":
      case "challenge":
      case "analysis":
      case "game":
        if (
          `${window.location.pathname}${window.location.search}` !==
          profileRoute
        ) {
          setFlash("Bot accounts are limited to their own profile.");
          navigate(profileRoute, true);
        }
        break;
      case "profile":
        if (route.username !== displayName) {
          setFlash("Bot accounts are limited to their own profile.");
          navigate(profileRoute, true);
        }
        break;
    }
  }, [route.kind, currentUser, navigate]);

  switch (route.kind) {
    case "games":
      return <GamesScreen />;
    case "spectate":
      return <SpectateScreen />;
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
          redirectTarget={route.redirect}
        />
      );
    case "settings":
      return <SettingsRedirect currentUser={currentUser} navigate={navigate} />;
    default:
      return <NotFoundScreen />;
  }
}
