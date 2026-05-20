import { useEffect } from "preact/hooks";
import type { UserData } from "../game/types";
import { activeFlash, clearFlash, setFlash } from "../utils/flash";
import { setAppCredential } from "../utils/storage";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { ErrorState } from "./screen-state";
import type { NavigateFn } from "./types";

async function fetchAuthToken() {
  try {
    const response = await fetch("/api/auth/token", {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const data = (await response.json()) as { token: string };

      if (data.token) {
        setAppCredential(data.token);
      }
    }
  } catch {
    // Silently ignore — not critical for login flow
  }
}

export function AuthFormScreen({
  mode,
  currentUser,
  navigate,
  refreshSession,
  redirectTarget,
}: {
  mode: "login" | "register";
  currentUser: UserData | undefined;
  navigate: NavigateFn;
  refreshSession: () => Promise<void>;
  redirectTarget?: string | null;
}) {
  useEffect(() => {
    setHead(
      pageTitle(mode === "login" ? "Log in" : "Register"),
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
      await fetchAuthToken();

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
        {mode === "register" && (
          <div>
            <label>
              <input type="checkbox" name="is_bot" value="true" /> This user is
              a bot
            </label>
          </div>
        )}
        <button type="submit">
          {mode === "login" ? "Log in" : "Register"}
        </button>
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

export function SettingsRedirect({
  currentUser,
  navigate,
}: {
  currentUser: UserData | undefined;
  navigate: NavigateFn;
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

export function NotFoundScreen() {
  useEffect(() => {
    setHead("Seki");
  }, []);

  return <ErrorState message="Page not found." />;
}
