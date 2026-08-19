import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AccountLinks } from "./components/account-menu";
import { AiModelDownloadDialog } from "./components/ai-model-download-dialog";
import { IconPlus } from "./components/icons";
import { NavDrawer } from "./components/nav-drawer";
import { NotificationBell } from "./components/notification-bell";
import { SettingsMenu } from "./components/settings-menu";
import type { UserData } from "./game/types";
import { initUnreadTracking } from "./game/unread";
import { readUserData, writeUserData } from "./game/util";
import { FlashBanner } from "./spa/flash-banner";
import {
  clearRouteDataCache,
  fetchJson,
  getBootstrapData,
  invalidateRouteData,
  prefetchRouteData,
  seedBootstrapCache,
} from "./spa/route-data";
import { currentUrl, getRouteDataUrl, parseRoute } from "./spa/routes";
import { Screen } from "./spa/screen";
import {
  activeFlash,
  clearFlash,
  readFlashFromUrl,
  setFlashState,
  stripFlashParams,
  type FlashMessage,
} from "./utils/flash";
import { repairPushSubscriptionIfNeeded } from "./utils/os-notifications";
import { initPreferences } from "./utils/preferences";
import {
  requestSpaNavigation,
  SPA_NAVIGATE_EVENT,
  type SpaNavigateDetail,
} from "./utils/spa-navigation";
import {
  clearAppCredential,
  getAppCredential,
  setAppCredential,
} from "./utils/storage";
import { initTheme } from "./utils/theme";
import { wsAuthReady, wsConnected } from "./ws";

type AuthTokenResponse = {
  token: string;
  user?: UserData;
};

function NavPresence() {
  const online = wsConnected.value;

  return (
    <span
      class={`nav-presence${online ? " online" : ""}`}
      title={online ? "Connected" : "Disconnected; reconnecting..."}
    />
  );
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

  const [authReady, setAuthReady] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  const initialFlash = useRef<FlashMessage | undefined>(
    getBootstrapData()?.flash ?? readFlashFromUrl(currentUrl()),
  );

  const seededInitialFlash = useRef(false);
  const lastFlashKey = useRef<string>();
  const preserveFlashForNextNavigation = useRef(false);
  const preserveFlashAfterUrlCleanup = useRef(false);

  useEffect(() => {
    initPreferences();
    initTheme();
    initUnreadTracking();

    void initializeAuth();
  }, []);

  useEffect(() => {
    const updateOnlineState = () => setOffline(!navigator.onLine);

    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector(".confirm-popover")) return;

      switch (event.key) {
        case "n":
          requestSpaNavigation("/games/new");
          break;
        case "s":
          requestSpaNavigation("/settings");
          break;
        case "g":
          requestSpaNavigation("/games");
          break;
        case "A":
          requestSpaNavigation("/analysis");
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function refreshSession() {
    const next = await fetchJson<UserData>("/api/session/me");

    writeUserData(next);
    initPreferences();
    initTheme();
    setCurrentUser(next);
    clearRouteDataCache();
  }

  async function initializeAuth() {
    const credential = getAppCredential();
    let restored = false;

    if (credential) {
      restored = await restoreCredential(credential);
    }

    if (!restored) {
      await fetchToken();
    }

    setAuthReady(true);

    wsAuthReady();
    void repairPushSubscriptionIfNeeded();
  }

  async function fetchToken() {
    try {
      const result = await fetchJson<AuthTokenResponse>("/api/auth/token");

      if (result.token) {
        setAppCredential(result.token);
      }

      if (result.user) {
        writeUserData(result.user);
        setCurrentUser(result.user);
        initPreferences();
        initTheme();
        clearRouteDataCache();
      }
    } catch {
      // Silently ignore — user may not have a session
    }
  }

  async function restoreCredential(credential: string): Promise<boolean> {
    try {
      const response = await fetch("/api/auth/restore", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential}`,
        },
      });

      if (!response.ok) {
        clearAppCredential();

        return false;
      }

      const result = (await response.json()) as {
        user: UserData;
        token: string;
      };

      if (result.user) {
        writeUserData(result.user);

        if (result.token) {
          setAppCredential(result.token);
        }

        setCurrentUser(result.user);
        initPreferences();
        initTheme();
        clearRouteDataCache();

        return true;
      }
    } catch {
      // Keep the cached credential; the next startup can retry restoration.
    }

    return false;
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
        invalidateRouteData(dataUrl);
      }
    }

    if (replace) {
      window.history.replaceState({}, "", nextKey);
    } else if (nextKey !== locationState.key) {
      window.history.pushState({}, "", nextKey);
    }

    setLocationState((prev) => ({
      key: nextKey,
      version: reload || nextKey !== prev.key ? prev.version + 1 : prev.version,
    }));

    if (!url.pathname.startsWith("/games/")) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  };

  useEffect(() => {
    const url = currentUrl();
    const key = `${url.pathname}${url.search}`;
    // authReady flips after mount and re-runs this effect; only evaluate the
    // flash when the URL actually changed, or a bootstrap flash would be
    // cleared the moment auth resolves.
    const keyChanged = lastFlashKey.current !== key;
    lastFlashKey.current = key;

    const initial = !seededInitialFlash.current;
    const nextFlash = initial
      ? (initialFlash.current ?? readFlashFromUrl(url))
      : keyChanged
        ? readFlashFromUrl(url)
        : undefined;

    seededInitialFlash.current = true;

    const preservedFlash =
      preserveFlashAfterUrlCleanup.current ||
      preserveFlashForNextNavigation.current;

    if (nextFlash) {
      setFlashState(nextFlash);
    } else if (keyChanged && !preservedFlash) {
      clearFlash();
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
        !(event.target instanceof Element) ||
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

      if (
        url.origin !== window.location.origin ||
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
      if (!authReady || !(event.target instanceof Element)) {
        return;
      }

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
    window.addEventListener(SPA_NAVIGATE_EVENT, onSpaNavigate as EventListener);
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
  }, [authReady, locationState.key]);

  const route = useMemo(
    () => parseRoute(currentUrl()),
    [locationState.key, locationState.version],
  );

  // Auth pages show only the brand — no nav links or account actions (the
  // anonymous session in the navbar is confusing mid-login).
  const isAuthPage =
    route.kind === "login" ||
    route.kind === "register" ||
    route.kind === "reset-password";

  async function handleLogout() {
    const credential = getAppCredential();

    if (credential) {
      await fetch("/api/auth/token", {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential}`,
        },
      }).catch(() => undefined);

      clearAppCredential();
    }

    await fetch("/logout", {
      method: "POST",
      headers: { Accept: "application/json" },
    });

    writeUserData(undefined);
    setCurrentUser(undefined);
    clearRouteDataCache();
    await fetchToken();

    // Close WebSocket so it reconnects with the new anonymous identity.
    window.__ws?.close();

    navigate("/", true);
  }

  return (
    <>
      <nav ref={navRef}>
        <div class="mobile-nav-brand">
          <a href="/games" class="brand-link">
            <span class="brand-stone" aria-hidden="true" />
            <span>Seki</span>
          </a>
        </div>
        {!isAuthPage && (
          <>
            <div class="desktop-nav-primary">
              {!currentUser?.is_bot && (
                <>
                  <a href="/games/new" title="New game" class="nav-icon">
                    <IconPlus />
                  </a>
                  <a href="/games">Games</a>
                  <a href="/games/spectate">Spectate</a>
                  <a href="/bot">Bot</a>
                  <a href="/analysis">Analysis</a>
                  <a href="/players">Players</a>
                </>
              )}
            </div>
            <div class="nav-actions">
              {!currentUser?.is_bot && <NavPresence />}
              {!currentUser?.is_bot && <NotificationBell />}
              <span class="desktop-only">
                {!currentUser?.is_bot && <SettingsMenu />}
              </span>
              <span class="desktop-only">
                <AccountLinks user={currentUser} onLogout={handleLogout} />
              </span>
              <span class="mobile-only">
                <NavDrawer user={currentUser} onLogout={handleLogout} />
              </span>
            </div>
          </>
        )}
      </nav>
      <FlashBanner />
      <AiModelDownloadDialog />
      {offline && (
        <div style="background:#e74c3c;color:#fff;text-align:center;padding:8px;font-size:14px">
          You are offline. Some features may be unavailable.
        </div>
      )}
      <main>
        {authReady && (
          <Screen
            route={route}
            currentUser={currentUser}
            navigate={navigate}
            refreshSession={refreshSession}
            key={`${locationState.key}:${locationState.version}`}
          />
        )}
      </main>
    </>
  );
}

export function mountApp() {
  seedBootstrapCache();
  // Preact appends rather than replaces container children, so clear the
  // shell's boot UI (spinner/fallback) before mounting the app.
  document.body.replaceChildren();
  render(<App />, document.body);
}
