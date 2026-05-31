import { useEffect, useState } from "preact/hooks";
import { NotificationSettings } from "../components/notification-settings";
import { RatingParticipationSettings } from "../components/rating-participation-settings";
import { UserLabel } from "../components/user-label";
import { UserGames } from "../layouts/user-games";
import { clearFlash, setFlash } from "../utils/flash";
import { formatNumericRating, fullRankText } from "../utils/rating";
import { authUrl } from "../utils/spa-navigation";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { useRouteData } from "./route-data";
import { ErrorState, LoadingState } from "./screen-state";
import type {
  NavigateFn,
  ProfileData,
  ProfileRatingData,
  RatingHistoryEntryData,
} from "./types";

type RatingGraphPoint = {
  x: number;
  y: number;
  rating: number;
};

export type RatingGraphData = {
  points: RatingGraphPoint[];
  path: string;
  minRating: number;
  maxRating: number;
  currentRating: number;
};

const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 220;
const GRAPH_PADDING = 32;

export function buildRatingGraphData(
  history: RatingHistoryEntryData[],
): RatingGraphData | null {
  if (history.length === 0) {
    return null;
  }

  const ratings = [
    history[0].rating_before,
    ...history.map((entry) => entry.rating_after),
  ];
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const ratingRange = maxRating - minRating || 1;
  const xRange = ratings.length - 1 || 1;
  const width = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const height = GRAPH_HEIGHT - GRAPH_PADDING * 2;

  const points = ratings.map((rating, index) => ({
    x: GRAPH_PADDING + (index / xRange) * width,
    y: GRAPH_PADDING + ((maxRating - rating) / ratingRange) * height,
    rating,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return {
    points,
    path,
    minRating,
    maxRating,
    currentRating: ratings[ratings.length - 1],
  };
}

function RatingGraph({ history }: { history: RatingHistoryEntryData[] }) {
  const graph = buildRatingGraphData(history);

  if (!graph) {
    return <p class="rating-graph-empty">No visible rated games yet.</p>;
  }

  const lastPoint = graph.points[graph.points.length - 1];

  return (
    <div class="rating-graph">
      <svg
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label={`Rating graph, current rating ${formatNumericRating(graph.currentRating)}`}
      >
        <line
          class="rating-graph-grid"
          x1={GRAPH_PADDING}
          y1={GRAPH_PADDING}
          x2={GRAPH_PADDING}
          y2={GRAPH_HEIGHT - GRAPH_PADDING}
        />
        <line
          class="rating-graph-grid"
          x1={GRAPH_PADDING}
          y1={GRAPH_HEIGHT - GRAPH_PADDING}
          x2={GRAPH_WIDTH - GRAPH_PADDING}
          y2={GRAPH_HEIGHT - GRAPH_PADDING}
        />
        <path class="rating-graph-line" d={graph.path} />
        {graph.points.map((point, index) => (
          <circle
            key={index}
            class="rating-graph-point"
            cx={point.x}
            cy={point.y}
            r={index === graph.points.length - 1 ? 4 : 3}
          >
            <title>{formatNumericRating(point.rating)}</title>
          </circle>
        ))}
        <text class="rating-graph-label" x={lastPoint.x} y={lastPoint.y - 10}>
          {formatNumericRating(graph.currentRating)}
        </text>
      </svg>
      <div class="rating-graph-meta">
        <span>
          Range {formatNumericRating(graph.minRating)}-
          {formatNumericRating(graph.maxRating)}
        </span>
        <span>{history.length} games</span>
      </div>
    </div>
  );
}

function RatingProfileSummary({ rating }: { rating: ProfileRatingData }) {
  const rankText = fullRankText(rating.rank);

  return (
    <section>
      <h2>Rating</h2>
      <p>
        {rankText}
        {rating.participating ? "" : " (-)"}
        {` · ${rating.rated_games} rated games`}
      </p>
      <RatingGraph history={rating.history} />
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
    const formData = new FormData(form);
    const displayName = form.elements.namedItem("display_name");

    if (displayName instanceof HTMLInputElement) {
      formData.set("username", displayName.value);
    }

    try {
      const result = await postForm(form.action, formData);
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
      {data.rating && <RatingProfileSummary rating={data.rating} />}
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
                  name="display_name"
                  defaultValue={data.profile_username}
                  maxLength={30}
                  autocomplete="nickname"
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
              <a href={authUrl("register")}>Register</a> to access API tokens
              and other settings.
            </p>
          )}
        </section>
      )}
    </>
  );
}
