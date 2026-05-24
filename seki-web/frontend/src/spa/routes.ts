import type { Route } from "./types";

export function currentUrl(): URL {
  return new URL(window.location.href);
}

export function parseRoute(url: URL): Route {
  const path = url.pathname;

  if (path === "/" || path === "/games") {
    return { kind: "games" };
  }

  if (path === "/games/spectate") {
    return { kind: "spectate" };
  }

  if (path === "/games/new") {
    return { kind: "new-game" };
  }

  const challengeMatch = path.match(/^\/games\/challenge\/([^/]+)$/);

  if (challengeMatch) {
    return {
      kind: "challenge",
      username: decodeURIComponent(challengeMatch[1]),
    };
  }

  if (path === "/analysis") {
    return { kind: "analysis" };
  }

  if (path === "/login") {
    return {
      kind: "login",
      redirect: url.searchParams.get("redirect"),
    };
  }

  if (path === "/register") {
    return { kind: "register" };
  }

  if (path === "/settings") {
    return { kind: "settings" };
  }

  const gameMatch = path.match(/^\/games\/(\d+)$/);

  if (gameMatch) {
    return {
      kind: "game",
      id: Number(gameMatch[1]),
      accessToken: url.searchParams.get("access_token"),
      inviteToken: url.searchParams.get("invite_token"),
    };
  }

  const userMatch = path.match(/^\/users\/([^/]+)$/);

  if (userMatch) {
    return {
      kind: "profile",
      username: decodeURIComponent(userMatch[1]),
    };
  }

  return { kind: "not-found" };
}

export function getRouteDataUrl(route: Route): string | undefined {
  switch (route.kind) {
    case "games":
    case "spectate":
      return "/api/web/games";
    case "new-game":
      return "/api/web/games/new";
    case "challenge":
      return `/api/web/games/new?opponent=${encodeURIComponent(route.username)}`;
    case "game":
      const gameParams = [
        route.accessToken
          ? `access_token=${encodeURIComponent(route.accessToken)}`
          : null,
        route.inviteToken
          ? `invite_token=${encodeURIComponent(route.inviteToken)}`
          : null,
      ].filter(Boolean);

      return gameParams.length > 0
        ? `/api/web/games/${route.id}?${gameParams.join("&")}`
        : `/api/web/games/${route.id}`;
    case "analysis":
      return "/api/web/analysis";
    case "profile":
      return `/api/web/users/${encodeURIComponent(route.username)}`;
    default:
      return undefined;
  }
}
