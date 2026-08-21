import { useEffect, useState } from "preact/hooks";
import { IconRenew } from "../components/icons";
import { NotificationSettings } from "../components/notification-settings";
import { RatingProfileSummary } from "../components/profile-rating-graph";
import { RatingParticipationSettings } from "../components/rating-participation-settings";
import { SubmitButton, useSubmitState } from "../components/submit-button";
import { UserLabel } from "../components/user-label";
import { UserGames } from "../layouts/user-games";
import { clearFlash, setFlash } from "../utils/flash";
import { authUrl } from "../utils/spa-navigation";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { fetchJson, useRouteData } from "./route-data";
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
  const [usernameState, runUsernameSubmit] = useSubmitState();
  const [emailState, runEmailSubmit] = useSubmitState();
  // Live copy of route data: identity edits update in place instead of
  // navigating, so the screen never remounts and the button keeps its
  // success state.
  const [live, setLive] = useState<ProfileData | undefined>(data);

  useEffect(() => {
    setLive(data);
  }, [data]);

  useEffect(() => {
    setHead(pageTitle(username), `${username}'s Go profile on Seki`);
  }, [username]);

  async function submitUsername(e: Event) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    runUsernameSubmit(async () => {
      await postForm(form.action, new FormData(form));
      await refreshSession();
      const newUsername = String(
        new FormData(form).get("username") ?? "",
      ).trim();
      // Mutate the address in place — the SPA state stays put, so there is
      // no remount and no loading flash.
      window.history.replaceState(
        {},
        "",
        `/users/${encodeURIComponent(newUsername)}`,
      );
      setLive(
        await fetchJson<ProfileData>(
          `/api/web/users/${encodeURIComponent(newUsername)}`,
        ),
      );
    });
  }

  async function submitEmail(e: Event) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    runEmailSubmit(async () => {
      const result = await postForm(form.action, new FormData(form));
      await refreshSession();

      if (typeof result.flash === "string") {
        setFlash(result.flash);
      }

      setLive(
        await fetchJson<ProfileData>(
          `/api/web/users/${encodeURIComponent(live?.profile_username ?? username)}`,
        ),
      );
    });
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

  const profile = live ?? data;

  return (
    <>
      <h1>
        <UserLabel user={profile.profile_user} noLink />
      </h1>
      {profile.is_own_profile && !profile.user_is_registered && (
        <p style={{ textAlign: "center" }}>
          <em class="fg-red">Attention!</em> You are using an anonymous,
          unregistered account. <a href={authUrl("register")}>Register here</a>{" "}
          and create a password to never lose access, participate in rankings
          and more.
        </p>
      )}
      {!profile.is_own_profile && (
        <button
          type="button"
          class="btn"
          onClick={() =>
            navigate(
              `/games/challenge/${encodeURIComponent(profile.profile_username)}`,
            )
          }
        >
          Challenge
        </button>
      )}
      {data.rating &&
        !(profile.is_own_profile && !profile.user_is_registered) && (
          <RatingProfileSummary rating={data.rating} navigate={navigate} />
        )}
      <section>
        <h2>Games</h2>
        <UserGames initial={data.initial_games} />
      </section>
      {data.is_own_profile && (
        <section>
          <h2>Settings</h2>
          {profile.user_is_registered && (
            <>
              <h3>Rating</h3>
              <RatingParticipationSettings
                ratingParticipating={
                  data.profile_user?.preferences.rating_participating
                }
                disabled={!data.user_is_registered}
              />
            </>
          )}
          <h3>Username</h3>
          <form
            key={`username-${profile.profile_username}`}
            action={`/users/${encodeURIComponent(profile.profile_username)}`}
            method="post"
            class="inline-form"
            onSubmit={submitUsername}
          >
            <input
              type="text"
              name="username"
              defaultValue={profile.profile_username}
              maxLength={30}
              style={{ width: "30ch" }}
            />
            <SubmitButton
              state={usernameState}
              idle="Update"
              busy="Updating"
              success="Updated"
            />
          </form>
          {!(profile.profile_user?.is_bot && profile.is_own_profile) && (
            <>
              <h3>Email</h3>
              {!profile.user_email && (
                <p>
                  <em>
                    {data.user_is_registered
                      ? "Heads up! You have no email set. Without one you will not be able to reset your password if you lose it; locking you out of your account forever."
                      : "Heads up! You have no email set. Add one so your account stays recoverable when you register."}
                  </em>
                </p>
              )}
              <form
                key={`email-${profile.profile_username}`}
                action="/settings/email"
                method="post"
                class="inline-form"
                onSubmit={submitEmail}
              >
                <input
                  type="email"
                  name="email"
                  defaultValue={profile.user_email ?? ""}
                  placeholder="your@email.com"
                  style={{ width: "30ch" }}
                />
                <SubmitButton
                  state={emailState}
                  idle={profile.user_email ? "Update" : "Save"}
                  busy="Saving"
                  success="Saved"
                />
              </form>
              <h3>Notifications</h3>
              <NotificationSettings hasEmail={!!profile.user_email} />
            </>
          )}
          {data.user_is_registered && (
            <>
              <h3>API Token</h3>
              <div class="api-token">
                <code id="api-token">{apiToken}</code>
                <button class="btn" type="button" onClick={generateToken}>
                  <IconRenew />
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
