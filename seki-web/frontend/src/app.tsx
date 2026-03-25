import { render } from "preact";
import type { ComponentType } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { GamesList, type InitMessage } from "./layouts/games-list";
import {
  UserGames,
  type UserGamesInitialData,
} from "./layouts/user-games";
import { ensureWasm } from "./goban/create-board";
import type { ChatEntry } from "./components/chat";
import { NotificationBell } from "./components/notification-bell";
import { ConnectionStatus } from "./components/connection-status";
import { UserMenu } from "./components/user-menu";
import { NotificationSettings } from "./components/notification-settings";
import { ensureConnected } from "./ws";
import { initUnreadTracking } from "./game/unread";
import { initTheme } from "./utils/theme";
import { initPreferences } from "./utils/preferences";
import { type InitialGameProps, type UserData } from "./game/types";
import { readUserData, writeUserData } from "./game/util";
import {
  SPA_NAVIGATE_EVENT,
  type SpaNavigateDetail,
} from "./utils/spa-navigation";
import { postForm } from "./utils/web-client";
import {
  activeFlash,
  clearFlash,
  readFlashFromUrl,
  setFlash,
  setFlashState,
  stripFlashParams,
  type FlashMessage,
} from "./utils/flash";
import { buildGameNavigationRedirect } from "./utils/navigation-errors";

void ensureWasm();

declare global {
  interface Window {
    __sekiBootstrap?: BootstrapPayload;
  }
}

type Route =
  | { kind: "games" }
  | { kind: "new-game"; opponent?: string | null }
  | {
      kind: "game";
      id: number;
      accessToken?: string | null;
      inviteToken?: string | null;
    }
  | { kind: "analysis" }
  | { kind: "profile"; username: string }
  | { kind: "login"; redirect?: string | null }
  | { kind: "register" }
  | { kind: "settings" }
  | { kind: "not-found" };

type FetchError = {
  status: number;
  message: string;
};

type GamePageData = {
  game_id: number;
  game_props: InitialGameProps;
  chat_log: ChatEntry[];
  og_title: string;
  og_description: string;
};

type NewGameData = {
  opponent?: string | null;
};

type ProfileData = {
  profile_username: string;
  initial_games: UserGamesInitialData;
  is_own_profile: boolean;
  api_token?: string | null;
  user_email?: string | null;
  user_is_registered: boolean;
};

type BootstrapPayload = {
  url?: string;
  data?: unknown;
  flash?: FlashMessage;
};

type GameSettingsFormProps = {
  opponent?: string;
};

const loadLiveGameModule = () => import("./layouts/live-game");
const loadAnalysisModule = () => import("./layouts/analysis");
const loadGameSettingsFormModule = () => import("./layouts/game-settings-form");

const routeDataCache = new Map<string, unknown>();
const inflightRouteData = new Map<string, Promise<unknown>>();

function currentUrl(): URL {
  return new URL(window.location.href);
}

function parseRoute(url: URL): Route {
  const path = url.pathname;
  if (path === "/" || path === "/games") {
    return { kind: "games" };
  }
  if (path === "/games/new") {
    return {
      kind: "new-game",
      opponent: url.searchParams.get("opponent"),
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.error ?? payload?.message ?? "Request failed";
    throw { status: response.status, message } satisfies FetchError;
  }

  return payload as T;
}

function getBootstrapData(): BootstrapPayload | undefined {
  if (window.__sekiBootstrap) {
    return window.__sekiBootstrap;
  }
  const el = document.getElementById("bootstrap-data");
  if (!el?.textContent) {
    return;
  }
  const payload = JSON.parse(el.textContent) as BootstrapPayload;
  window.__sekiBootstrap = payload;
  return payload;
}

function seedBootstrapCache(): void {
  const payload = getBootstrapData();
  if (payload?.url && payload.data !== undefined) {
    routeDataCache.set(payload.url, payload.data);
  }
}

function getRouteDataUrl(route: Route): string | undefined {
  switch (route.kind) {
    case "games":
      return "/api/web/games";
    case "new-game":
      return route.opponent
        ? `/api/web/games/new?opponent=${encodeURIComponent(route.opponent)}`
        : "/api/web/games/new";
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

async function fetchRouteData<T>(url: string): Promise<T> {
  if (routeDataCache.has(url)) {
    return routeDataCache.get(url) as T;
  }
  const inflight = inflightRouteData.get(url);
  if (inflight) {
    return (await inflight) as T;
  }
  const request = fetchJson<T>(url)
    .then((data) => {
      routeDataCache.set(url, data);
      inflightRouteData.delete(url);
      return data;
    })
    .catch((err) => {
      inflightRouteData.delete(url);
      throw err;
    });
  inflightRouteData.set(url, request as Promise<unknown>);
  return request;
}

function prefetchRouteData(url: string | undefined): void {
  if (!url || routeDataCache.has(url) || inflightRouteData.has(url)) {
    return;
  }
  void fetchRouteData(url);
}

async function patchJson(
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw {
      status: response.status,
      message: data.error ?? "Request failed",
      field: data.field,
    };
  }
  return data;
}

function setHead(title: string, description?: string): void {
  document.title = title;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    ogTitle.setAttribute("content", title);
  }
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription && description) {
    ogDescription.setAttribute("content", description);
  }
}

function ErrorState({ message }: { message: string }) {
  return <p>{message}</p>;
}

function LoadingState() {
  return <p>Loading...</p>;
}

function FlashBanner() {
  const flash = activeFlash.value;

  if (!flash) {
    return null;
  }

  return (
    <div
      class={`flash-banner flash-banner-${flash.severity}`}
      role="alert"
      aria-live="assertive"
      onClick={() => clearFlash()}
    >
      <div class="flash-banner-body">
        <span>{flash.message}</span>
        <button
          type="button"
          class="flash-banner-close"
          aria-label="Dismiss message"
          onClick={(event) => {
            event.stopPropagation();
            clearFlash();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function useLazyModule<T>(loader: () => Promise<T>) {
  const [mod, setMod] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((next) => {
        if (!cancelled) {
          setMod(next);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  return { mod, error };
}

function useRouteData<T>(url: string) {
  const [data, setData] = useState<T | undefined>(() =>
    routeDataCache.get(url) as T | undefined,
  );
  const [error, setError] = useState<FetchError | undefined>();

  useEffect(() => {
    let cancelled = false;
    const cached = routeDataCache.get(url) as T | undefined;
    setData(cached);
    setError(undefined);
    fetchRouteData<T>(url)
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch((err: FetchError) => {
        if (!cancelled) {
          setError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, error };
}

function LiveGameScreen({ data }: { data: GamePageData }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { mod, error } = useLazyModule(loadLiveGameModule);

  useEffect(() => {
    setHead(data.og_title, data.og_description);
  }, [data]);

  useEffect(() => {
    if (!rootRef.current || !mod) {
      return;
    }
    return mod.liveGame(
      data.game_props,
      data.game_id,
      rootRef.current,
      data.chat_log,
    );
  }, [data, mod]);

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div class="game-page">
      <div ref={rootRef} class="game-page-body" />
      {!mod && <LoadingState />}
      <div id="game-error"></div>
    </div>
  );
}

function AnalysisScreen() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { mod, error } = useLazyModule(loadAnalysisModule);

  useEffect(() => {
    setHead("Analysis Board - Seki", "Play Go (Weiqi/Baduk) online with friends");
  }, []);

  useEffect(() => {
    if (!rootRef.current || !mod) {
      return;
    }
    return mod.initAnalysis(rootRef.current);
  }, [mod]);

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div class="game-page">
      <div ref={rootRef} class="game-page-body" />
      {!mod && <LoadingState />}
    </div>
  );
}

function GamesScreen() {
  const { data, error } = useRouteData<InitMessage>("/api/web/games");

  useEffect(() => {
    setHead("Games - Seki", "Play Go (Weiqi/Baduk) online with friends");
  }, []);

  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (!data) {
    return <LoadingState />;
  }
  return <GamesList initial={data} />;
}

function GameScreenRoute({
  route,
  navigate,
}: {
  route: Extract<Route, { kind: "game" }>;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
}) {
  const parts = [
    route.kind === "game" && route.accessToken
      ? `access_token=${encodeURIComponent(route.accessToken)}`
      : null,
    route.kind === "game" && route.inviteToken
      ? `invite_token=${encodeURIComponent(route.inviteToken)}`
      : null,
  ].filter(Boolean);
  const params = parts.length > 0 ? `?${parts.join("&")}` : "";
  const routePath = `/games/${route.id}${params}`;
  const { data, error } = useRouteData<GamePageData>(
    `/api/web/games/${route.id}${params}`,
  );

  useEffect(() => {
    if (!error) {
      return;
    }
    const redirect = buildGameNavigationRedirect(route.id, error, routePath);
    if (redirect) {
      setFlash(redirect.flash);
      navigate(redirect.to, true, false, true);
    }
  }, [error, navigate, route.id, routePath]);

  if (error) {
    if (buildGameNavigationRedirect(route.id, error, routePath)) {
      return <LoadingState />;
    }
    return <ErrorState message={error.message} />;
  }
  if (!data) {
    return <LoadingState />;
  }
  return <LiveGameScreen data={data} />;
}

function NewGameScreen({
  route,
  navigate,
}: {
  route: Extract<Route, { kind: "new-game" }>;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
}) {
  const { data } = useRouteData<NewGameData>(
    `/api/web/games/new${route.opponent ? `?opponent=${encodeURIComponent(route.opponent)}` : ""}`,
  );
  const {
    mod: formModule,
    error: formError,
  } = useLazyModule(loadGameSettingsFormModule);

  const FormComponent = formModule?.GameSettingsForm as
    | ComponentType<GameSettingsFormProps>
    | undefined;

  useEffect(() => {
    setHead("New Game - Seki", "Play Go (Weiqi/Baduk) online with friends");
  }, []);

  async function onSubmit(e: Event) {
    e.preventDefault();
    clearFlash();
    const form = e.currentTarget as HTMLFormElement;
    try {
      const result = await postForm("/games", new FormData(form));
      const redirect = result.redirect;
      if (typeof redirect === "string") {
        navigate(redirect);
      }
    } catch (err) {
      setFlash((err as { message: string }).message);
    }
  }

  if (formError) {
    return <ErrorState message={formError} />;
  }

  return (
    <>
      <h1>New Game</h1>
      <form id="new-game-form" action="/games" method="post" onSubmit={onSubmit}>
        {FormComponent ? (
          <FormComponent opponent={data?.opponent ?? undefined} />
        ) : (
          <LoadingState />
        )}
      </form>
    </>
  );
}

function ProfileScreen({
  username,
  navigate,
  refreshSession,
}: {
  username: string;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
  refreshSession: () => Promise<void>;
}) {
  const { data, error } = useRouteData<ProfileData>(
    `/api/web/users/${encodeURIComponent(username)}`,
  );
  const [tokenVisible, setTokenVisible] = useState(false);

  useEffect(() => {
    setHead(`${username} - Seki`, `${username}'s Go profile on Seki`);
  }, [username]);

  async function submitUsername(e: Event) {
    e.preventDefault();
    clearFlash();
    const form = e.currentTarget as HTMLFormElement;
    try {
      const result = await postForm(form.action, new FormData(form));
      await refreshSession();
      if (typeof result.redirect === "string") {
        navigate(result.redirect);
      }
    } catch (err) {
      setFlash((err as { message: string }).message);
    }
  }

  async function submitEmail(e: Event) {
    e.preventDefault();
    clearFlash();
    const form = e.currentTarget as HTMLFormElement;
    try {
      const result = await postForm(form.action, new FormData(form));
      await refreshSession();
      if (typeof result.redirect === "string") {
        navigate(result.redirect, true, true);
      }
    } catch (err) {
      setFlash((err as { message: string }).message);
    }
  }

  async function generateToken() {
    clearFlash();
    try {
      const response = await fetch("/settings/token", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Request failed");
      }
      if (typeof result.redirect === "string") {
        navigate(result.redirect, true, true);
      }
    } catch (err) {
      setFlash((err as Error).message);
    }
  }

  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (!data) {
    return <LoadingState />;
  }

  return (
    <>
      <h1>{data.profile_username}</h1>
      {!data.is_own_profile && (
        <a
          href={`/games/new?opponent=${encodeURIComponent(data.profile_username)}`}
          class="btn"
          style={{ fontSize: "0.85em" }}
        >
          Challenge
        </a>
      )}
      <h2>Games</h2>
      <UserGames initial={data.initial_games} />
      {data.is_own_profile && (
        <section>
          <h2>Settings</h2>
          {data.user_is_registered ? (
            <>
              <h3>Username</h3>
              <form
                key={`username-${data.profile_username}`}
                action={`/users/${encodeURIComponent(data.profile_username)}`}
                method="post"
                class="inline-form"
                onSubmit={submitUsername}
              >
                <input
                  type="text"
                  name="username"
                  defaultValue={data.profile_username}
                  maxLength={30}
                />
                <button type="submit">Update</button>
              </form>
              <h3>Email</h3>
              <form
                key={`email-${data.profile_username}`}
                action="/settings/email"
                method="post"
                class="inline-form"
                onSubmit={submitEmail}
              >
                <input
                  type="email"
                  name="email"
                  defaultValue={data.user_email ?? ""}
                  placeholder="your@email.com"
                />
                <button type="submit">
                  {data.user_email ? "Update" : "Save"}
                </button>
              </form>
              <h3>Notifications</h3>
              <NotificationSettings hasEmail={!!data.user_email} />
              <h3>API Token</h3>
              <p>
                Use this token to authenticate with the API via{" "}
                <code>Authorization: Bearer &lt;token&gt;</code>.
              </p>
              <div class="inline-form">
                {data.api_token ? (
                  <>
                    <input
                      id="api-token"
                      type={tokenVisible ? "text" : "password"}
                      value={data.api_token}
                      readOnly
                      style={{ fontFamily: "monospace" }}
                    />
                    <button
                      type="button"
                      onClick={() => setTokenVisible((visible) => !visible)}
                    >
                      {tokenVisible ? "Hide" : "Show"}
                    </button>
                    <button type="button" onClick={generateToken}>
                      Regenerate Token
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={generateToken}>
                    Generate Token
                  </button>
                )}
              </div>
            </>
          ) : (
            <p>
              <a href="/register">Register</a> to access API tokens and other
              settings.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function AuthFormScreen({
  mode,
  currentUser,
  navigate,
  refreshSession,
  redirectTarget,
}: {
  mode: "login" | "register";
  currentUser: UserData | undefined;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
  refreshSession: () => Promise<void>;
  redirectTarget?: string | null;
}) {
  useEffect(() => {
    setHead(
      mode === "login" ? "Log in — Seki" : "Register — Seki",
      "Play Go (Weiqi/Baduk) online with friends",
    );
    if (currentUser?.is_registered) {
      navigate("/", true);
    }
  }, [mode, currentUser, navigate]);

  async function onSubmit(e: Event) {
    e.preventDefault();
    clearFlash();
    const form = e.currentTarget as HTMLFormElement;
    const action =
      mode === "login" && redirectTarget
        ? `/login?redirect=${encodeURIComponent(redirectTarget)}`
        : `/${mode}`;
    try {
      const result = await postForm(action, new FormData(form));
      await refreshSession();
      if (typeof result.redirect === "string") {
        navigate(result.redirect, true);
      }
    } catch (err) {
      setFlash((err as { message: string }).message);
    }
  }

  if (currentUser?.is_registered) {
    return null;
  }

  return (
    <>
      <h1>{mode === "login" ? "Log in" : "Register"}</h1>
      <form
        action={mode === "login" ? "/login" : "/register"}
        method="post"
        onSubmit={onSubmit}
      >
        <div>
          <label for="username">Username</label>
          <input
            type="text"
            name="username"
            id="username"
            required
            maxLength={30}
            autoFocus
          />
        </div>
        <div>
          <label for="password">Password</label>
          <input
            type="password"
            name="password"
            id="password"
            required
            minLength={8}
          />
        </div>
        {mode === "register" && (
          <div>
            <label for="password_confirmation">Confirm password</label>
            <input
              type="password"
              name="password_confirmation"
              id="password_confirmation"
              required
              minLength={8}
            />
          </div>
        )}
        <button type="submit">{mode === "login" ? "Log in" : "Register"}</button>
      </form>
      <p>
        {mode === "login" ? (
          <>
            Don&apos;t have an account? <a href="/register">Register</a>
          </>
        ) : (
          <>
            Already have an account? <a href="/login">Log in</a>
          </>
        )}
      </p>
    </>
  );
}

function SettingsRedirect({
  currentUser,
  navigate,
}: {
  currentUser: UserData | undefined;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
}) {
  useEffect(() => {
    if (currentUser?.display_name) {
      navigate(
        `/users/${encodeURIComponent(currentUser.display_name)}`,
        true,
        false,
        !!activeFlash.value,
      );
    }
  }, [currentUser, navigate]);

  return null;
}

function NotFoundScreen() {
  useEffect(() => {
    setHead("Seki");
  }, []);

  return <ErrorState message="Page not found." />;
}

function Screen({
  route,
  currentUser,
  navigate,
  refreshSession,
}: {
  route: Route;
  currentUser: UserData | undefined;
  navigate: (
    to: string,
    replace?: boolean,
    reload?: boolean,
    preserveFlash?: boolean,
  ) => void;
  refreshSession: () => Promise<void>;
}) {
  switch (route.kind) {
    case "games":
      return <GamesScreen />;
    case "new-game":
      return <NewGameScreen route={route} navigate={navigate} />;
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
      return (
        <SettingsRedirect
          currentUser={currentUser}
          navigate={navigate}
        />
      );
    default:
      return <NotFoundScreen />;
  }
}

function App() {
  const navRef = useRef<HTMLElement>(null);
  const [locationState, setLocationState] = useState(() => ({
    key: `${window.location.pathname}${window.location.search}`,
    version: 0,
  }));
  const [currentUser, setCurrentUser] = useState<UserData | undefined>(() =>
    readUserData(),
  );
  const initialFlash = useRef<FlashMessage | undefined>(
    getBootstrapData()?.flash ?? readFlashFromUrl(currentUrl()),
  );
  const seededInitialFlash = useRef(false);
  const preserveFlashForNextNavigation = useRef(false);
  const preserveFlashAfterUrlCleanup = useRef(false);

  useEffect(() => {
    initPreferences();
    initTheme();
    initUnreadTracking();
    ensureConnected();
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const setNavHeight = () => {
      document.documentElement.style.setProperty(
        "--nav-height",
        `${nav.offsetHeight}px`,
      );
    };
    setNavHeight();
    const observer = new ResizeObserver(setNavHeight);
    observer.observe(nav);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeFlash.value) {
        clearFlash();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function refreshSession() {
    const next = await fetchJson<UserData>("/api/session/me");
    writeUserData(next);
    initPreferences();
    initTheme();
    setCurrentUser(next);
  }

  const navigate = (
    to: string,
    replace = false,
    reload = false,
    preserveFlash = false,
  ) => {
    const url = new URL(to, window.location.origin);
    const nextKey = `${url.pathname}${url.search}`;
    preserveFlashForNextNavigation.current = preserveFlash;
    if (reload) {
      const dataUrl = getRouteDataUrl(parseRoute(url));
      if (dataUrl) {
        routeDataCache.delete(dataUrl);
        inflightRouteData.delete(dataUrl);
      }
    }
    if (replace) {
      window.history.replaceState({}, "", nextKey);
    } else if (nextKey !== locationState.key) {
      window.history.pushState({}, "", nextKey);
    }
    setLocationState((prev) => ({
      key: nextKey,
      version:
        reload || nextKey !== prev.key ? prev.version + 1 : prev.version,
    }));
    if (!url.pathname.startsWith("/games/")) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  };

  useEffect(() => {
    const url = currentUrl();
    const initial = !seededInitialFlash.current;
    const nextFlash = initial
      ? initialFlash.current ?? readFlashFromUrl(url)
      : readFlashFromUrl(url);
    seededInitialFlash.current = true;
    const preservedFlash =
      preserveFlashAfterUrlCleanup.current || preserveFlashForNextNavigation.current;
    if (nextFlash) {
      setFlashState(nextFlash);
    } else {
      if (!preservedFlash) {
        clearFlash();
      }
    }
    preserveFlashAfterUrlCleanup.current = false;
    preserveFlashForNextNavigation.current = false;

    const strippedKey = stripFlashParams(url);
    if (strippedKey !== `${url.pathname}${url.search}`) {
      preserveFlashAfterUrlCleanup.current = !!nextFlash;
      window.history.replaceState({}, "", strippedKey);
      setLocationState((prev) =>
        prev.key === strippedKey ? prev : { ...prev, key: strippedKey },
      );
    }

    const onPopState = () => {
      setLocationState((prev) => ({
        key: `${window.location.pathname}${window.location.search}`,
        version: prev.version + 1,
      }));
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link || link.target || link.hasAttribute("download")) {
        return;
      }
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) {
        return;
      }
      if (
        url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/static") ||
        url.pathname === "/up"
      ) {
        return;
      }
      event.preventDefault();
      navigate(`${url.pathname}${url.search}`);
    };
    const onPrefetch = (event: MouseEvent | FocusEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link) {
        return;
      }
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) {
        return;
      }
      prefetchRouteData(getRouteDataUrl(parseRoute(url)));
    };
    const onSpaNavigate = (event: Event) => {
      const detail = (event as CustomEvent<SpaNavigateDetail>).detail;
      if (!detail?.to) {
        return;
      }
      navigate(detail.to, detail.replace, detail.reload);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener(
      SPA_NAVIGATE_EVENT,
      onSpaNavigate as EventListener,
    );
    document.addEventListener("click", onClick);
    document.addEventListener("mouseenter", onPrefetch, true);
    document.addEventListener("focusin", onPrefetch);
    document.addEventListener("touchstart", onPrefetch, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener(
        SPA_NAVIGATE_EVENT,
        onSpaNavigate as EventListener,
      );
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseenter", onPrefetch, true);
      document.removeEventListener("focusin", onPrefetch);
      document.removeEventListener("touchstart", onPrefetch, true);
    };
  }, [locationState.key]);

  const route = useMemo(
    () => parseRoute(currentUrl()),
    [locationState.key, locationState.version],
  );

  async function handleLogout() {
    await fetch("/logout", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    await refreshSession();
    navigate("/", true);
  }

  return (
    <>
      <nav ref={navRef}>
        <div>
          <a href="/games/new" title="New game">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 -960 960 960"
              fill="currentColor"
            >
              <path d="M451.5-131.5Q440-143 440-160v-280H160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520h280v-280q0-17 11.5-28.5T480-840q17 0 28.5 11.5T520-800v280h280q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H520v280q0 17-11.5 28.5T480-120q-17 0-28.5-11.5Z" />
            </svg>
          </a>
          <a href="/games">Games</a>
          <a href="/analysis">Analysis</a>
        </div>
        <div>
          <ConnectionStatus />
          <NotificationBell />
          <UserMenu onLogout={handleLogout} />
        </div>
      </nav>
      <FlashBanner />
      <main>
        <Screen
          route={route}
          currentUser={currentUser}
          navigate={navigate}
          refreshSession={refreshSession}
          key={`${locationState.key}:${locationState.version}`}
        />
      </main>
    </>
  );
}

export function mountApp() {
  seedBootstrapCache();
  render(<App />, document.body);
}
