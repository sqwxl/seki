import { useEffect, useState } from "preact/hooks";
import { IconRenew } from "../components/icons";
import { NotificationSettings } from "../components/notification-settings";
import { RatingProfileSummary } from "../components/profile-rating-graph";
import { RatingParticipationSettings } from "../components/rating-participation-settings";
import { UserLabel } from "../components/user-label";
import { UserGames } from "../layouts/user-games";
import { clearFlash, setFlash } from "../utils/flash";
import { authUrl } from "../utils/spa-navigation";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { useRouteData } from "./route-data";
import { ErrorState, LoadingState } from "./screen-state";
import type { NavigateFn, ProfileData } from "./types";

type GenerateTokenResult = {
  api_token?: string | null;
  error?: string;
};

export function ProfileScreen({
  username,
  navigate,
  refreshSession,
}: {
  username: string;
  navigate: NavigateFn;
  refreshSession: () => Promise<void>;
}) {
  const { data, error } = useRouteData<ProfileData>(
    `/api/web/users/${encodeURIComponent(username)}`,
  );
  const [apiToken, setApiToken] = useState<string | null>(null);

  useEffect(() => {
    setHead(pageTitle(username), `${username}'s Go profile on Seki`);
  }, [username]);

  useEffect(() => {
    setApiToken(data?.api_token ?? null);
  }, [data?.api_token]);

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
      const result = (await response.json()) as GenerateTokenResult;

      if (!response.ok) {
        throw new Error(result.error ?? "Request failed");
      }

      if (typeof result.api_token === "string") {
        setApiToken(result.api_token);
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
      <h1>
        <UserLabel user={data.profile_user} noLink />
      </h1>
      {!data.is_own_profile && (
        <button
          type="button"
          class="btn"
          onClick={() =>
            navigate(
              `/games/challenge/${encodeURIComponent(data.profile_username)}`,
            )
          }
        >
          Challenge
        </button>
      )}
      {data.rating && (
        <RatingProfileSummary rating={data.rating} navigate={navigate} />
      )}
      <h2>Games</h2>
      <UserGames initial={data.initial_games} />
      {data.is_own_profile && (
        <section>
          <h2>Settings</h2>
          {data.user_is_registered ? (
            <>
              <h3>Rating</h3>
              <RatingParticipationSettings
                ratingParticipating={
                  data.profile_user?.preferences.rating_participating
                }
              />
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
                  style={{ width: "30ch" }}
                />
                <button type="submit">Update</button>
              </form>
              {!(data.profile_user?.is_bot && data.is_own_profile) && (
                <>
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
                      style={{ width: "30ch" }}
                    />
                    <button type="submit">
                      {data.user_email ? "Update" : "Save"}
                    </button>
                  </form>
                  <h3>Notifications</h3>
                  <NotificationSettings hasEmail={!!data.user_email} />
                </>
              )}
              <h3>API Token</h3>
              <div class="api-token">
                <code id="api-token">{apiToken}</code>
                <button class="btn" type="button" onClick={generateToken}>
                  <IconRenew />
                </button>
              </div>
            </>
          ) : (
            <p>
              <a href={authUrl("register")}>Register</a> to access API tokens
              and other settings.
            </p>
          )}
        </section>
      )}
    </>
  );
}
