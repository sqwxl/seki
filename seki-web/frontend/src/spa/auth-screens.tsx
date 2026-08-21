import { useEffect, useState } from "preact/hooks";
import type { UserData } from "../game/types";
import { readUserData } from "../game/util";
import { PASSWORD_MIN_LENGTH } from "../utils/constants";
import { activeFlash, clearFlash, setFlash } from "../utils/flash";
import { authUrl } from "../utils/spa-navigation";
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
        : mode === "register" && redirectTarget
          ? `/register?redirect=${encodeURIComponent(redirectTarget)}`
          : `/${mode}`;

    try {
      const result = await postForm(action, new FormData(form));

      await refreshSession();
      await fetchAuthToken();

      // Close WebSocket so it reconnects with the new session identity.
      // Otherwise game actions use the pre-login (anonymous) user ID and
      // fail with "Only players can perform this action".
      window.__ws?.close();

      const registeredWithEmail =
        mode === "register" &&
        typeof new FormData(form).get("email") === "string" &&
        (new FormData(form).get("email") as string).trim() !== "";
      if (registeredWithEmail) {
        setFlash("Confirmation email sent — check your inbox.");
      }

      const botUser = readUserData();
      if (botUser?.is_bot) {
        navigate(
          `/users/${encodeURIComponent(botUser.display_name)}`,
          true,
          false,
          registeredWithEmail,
        );
      } else if (typeof result.redirect === "string") {
        navigate(result.redirect, true, false, registeredWithEmail);
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
        action={`/${mode}${redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : ""}`}
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
            defaultValue={
              mode === "register" ? (currentUser?.display_name ?? "") : ""
            }
            autocomplete="username"
            autoFocus
          />
        </div>
        {mode === "register" && (
          <div>
            <label for="email">Email (optional)</label>
            <input
              type="email"
              name="email"
              id="email"
              autocomplete="email"
              defaultValue={currentUser?.email ?? ""}
            />
            <p class="form-help">
              An email is optional, but without one, you will not be able to
              reset your password if you lose it.
            </p>
          </div>
        )}
        <div>
          <label for="password">Password</label>
          <input
            type="password"
            name="password"
            id="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autocomplete={
              mode === "login" ? "current-password" : "new-password"
            }
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
              minLength={PASSWORD_MIN_LENGTH}
              autocomplete="new-password"
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
        {mode === "login" && (
          <p>
            <a href="/reset-password">Forgot password?</a>
          </p>
        )}
      </form>
      <p>
        {mode === "login" ? (
          <>
            Don&apos;t have an account?{" "}
            <a href={authUrl("register")}>Register</a>
          </>
        ) : (
          <>
            Already have an account? <a href={authUrl("login")}>Log in</a>
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

export function ConfirmEmailScreen({ token }: { token?: string | null }) {
  const [state, setState] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    setHead(pageTitle("Confirm email"), "Confirm your email address");

    if (!token) {
      setState("error");
      setMessage("This confirmation link is invalid or has expired.");
      return;
    }

    (async () => {
      try {
        const response = await fetch("/api/web/confirm-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ token }),
        });

        if (response.ok) {
          setState("success");
          return;
        }

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setState("error");
        setMessage(
          data.error ?? "This confirmation link is invalid or has expired.",
        );
      } catch {
        setState("error");
        setMessage("Something went wrong. Please try again.");
      }
    })();
  }, [token]);

  return (
    <>
      <h1>Confirm email</h1>
      {state === "loading" && <p>Confirming…</p>}
      {state === "success" && (
        <p style={{ textAlign: "center" }}>
          <em>Your email was confirmed.</em>
        </p>
      )}
      {state === "error" && (
        <p style={{ textAlign: "center" }}>
          <em>{message}</em>
        </p>
      )}
    </>
  );
}
