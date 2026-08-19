import { useEffect, useState } from "preact/hooks";
import { SubmitButton, useSubmitState } from "../components/submit-button";
import { PASSWORD_MIN_LENGTH } from "../utils/constants";
import { clearFlash, setFlash } from "../utils/flash";
import { postForm } from "../utils/web-client";
import { setHead } from "./head";

type TokenInfo = { valid: true; username: string } | { valid: false };

/**
 * Password reset screen. Without a token it's a request form; with a token it
 * pre-validates via the API, then shows the new-password form, which submits
 * natively so browsers prompt to save/update the stored credential.
 */
export function ResetPasswordScreen({ token }: { token?: string | null }) {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | undefined>(undefined);
  const [requestState, runRequestSubmit] = useSubmitState();

  useEffect(() => {
    setHead("Reset password", "Reset your Seki password");
  }, []);

  useEffect(() => {
    if (!token) {
      setTokenInfo({ valid: false });
      return;
    }
    let cancelled = false;
    fetch(`/api/web/password-reset?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json())
      .then((info: TokenInfo) => {
        if (!cancelled) {
          setTokenInfo(info);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenInfo({ valid: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (token && !tokenInfo) {
    return (
      <>
        <h1>Reset password</h1>
        <p>Checking your reset link…</p>
      </>
    );
  }

  if (token && tokenInfo) {
    if (!tokenInfo.valid) {
      return (
        <>
          <h1>Reset password</h1>
          <p>This reset link is invalid or has expired.</p>
          <p>
            <a href="/reset-password">Request a new link</a>
          </p>
        </>
      );
    }

    return (
      <>
        <h1>Reset password</h1>
        {/* Native submit so the browser offers to save/update the credential. */}
        <form method="post" action="/reset-password">
          <div>
            <label for="username">Account</label>
            <input
              type="text"
              id="username"
              value={tokenInfo.username}
              disabled
              autocomplete="username"
            />
          </div>
          <input type="hidden" name="token" value={token} />
          <div>
            <label for="password">New password</label>
            <input
              type="password"
              name="password"
              id="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autocomplete="new-password"
            />
          </div>
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
          <button type="submit">Reset password</button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Reset password</h1>
      <form
        action="/reset-password/request"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          runRequestSubmit(async () => {
            clearFlash();
            const result = await postForm(
              "/reset-password/request",
              new FormData(form),
            );
            setFlash(
              (result.message as string) ??
                "If an account exists with that email, a reset link has been sent.",
              "success",
            );
          });
        }}
      >
        <div>
          <label for="email">Email</label>
          <input
            type="email"
            name="email"
            id="email"
            required
            autocomplete="email"
            autoFocus
          />
        </div>
        <SubmitButton
          state={requestState}
          idle="Send reset link"
          busy="Sending"
          success="Sent"
        />
      </form>
    </>
  );
}
