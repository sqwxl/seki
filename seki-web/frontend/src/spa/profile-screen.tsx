import { useEffect, useState } from "preact/hooks";
import { NotificationSettings } from "../components/notification-settings";
import { UserGames } from "../layouts/user-games";
import { clearFlash, setFlash } from "../utils/flash";
import { formatNumericRating, fullRankText } from "../utils/rating";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { useRouteData } from "./route-data";
import { ErrorState, LoadingState } from "./screen-state";
import type { NavigateFn, ProfileData, ProfileRatingData } from "./types";

function RatingProfileSummary({ rating }: { rating: ProfileRatingData }) {
  const latest = rating.history[rating.history.length - 1];
  const rankText = fullRankText(rating.rank);

  return (
    <section>
      <h2>Rating</h2>
      <p>
        {rankText}
        {rating.participating ? "" : " (-)"}
        {` · ${rating.rated_games} rated games`}
      </p>
      {latest && (
        <table>
          <thead>
            <tr>
              <th>Game</th>
              <th>Result</th>
              <th>Before</th>
              <th>After</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {rating.history.map((entry) => (
              <tr key={`${entry.game_id}-${entry.created_at}`}>
                <td>
                  <a href={`/games/${entry.game_id}`}>#{entry.game_id}</a>
                </td>
                <td>{entry.result}</td>
                <td>{formatNumericRating(entry.rating_before)}</td>
                <td>{formatNumericRating(entry.rating_after)}</td>
                <td>
                  {entry.rating_delta > 0 ? "+" : ""}
                  {formatNumericRating(entry.rating_delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

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
  const [tokenVisible, setTokenVisible] = useState(false);

  useEffect(() => {
    setHead(pageTitle(username), `${username}'s Go profile on Seki`);
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
          href={`/games/challenge/${encodeURIComponent(data.profile_username)}`}
          class="btn"
          style={{ fontSize: "0.85em" }}
        >
          Challenge
        </a>
      )}
      {data.rating && <RatingProfileSummary rating={data.rating} />}
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
              <NotificationSettings
                hasEmail={!!data.user_email}
                ratingParticipating={
                  data.profile_user?.preferences.rating_participating
                }
              />
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
