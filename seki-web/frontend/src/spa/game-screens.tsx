import type { ComponentType } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { GamesList, type InitMessage } from "../layouts/games-list";
import { clearFlash, setFlash } from "../utils/flash";
import { buildGameNavigationRedirect } from "../utils/navigation-errors";
import { fullRankText } from "../utils/rating";
import { postForm } from "../utils/web-client";
import { pageTitle, setHead } from "./head";
import { useRouteData } from "./route-data";
import { ErrorState, LoadingState, useLazyModule } from "./screen-state";
import type {
  GamePageData,
  GameSettingsFormProps,
  NavigateFn,
  NewGameData,
  Route,
} from "./types";

const loadLiveGameModule = () => import("../layouts/live-game");
const loadAnalysisModule = () => import("../layouts/analysis");
const loadGameSettingsFormModule = () =>
  import("../layouts/game-settings-form");

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

export function AnalysisScreen() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { mod, error } = useLazyModule(loadAnalysisModule);

  useEffect(() => {
    setHead(
      pageTitle("Analysis Board"),
      "Play Go (Weiqi/Baduk) online with friends",
    );
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

export function GamesScreen() {
  const { data, error } = useRouteData<InitMessage>("/api/web/games");

  useEffect(() => {
    setHead(pageTitle("Games"), "Play Go (Weiqi/Baduk) online with friends");
  }, []);

  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (!data) {
    return <LoadingState />;
  }
  return <GamesList initial={data} />;
}

export function GameScreenRoute({
  route,
  navigate,
}: {
  route: Extract<Route, { kind: "game" }>;
  navigate: NavigateFn;
}) {
  const parts = [
    route.accessToken
      ? `access_token=${encodeURIComponent(route.accessToken)}`
      : null,
    route.inviteToken
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

export function NewGameScreen({ navigate }: { navigate: NavigateFn }) {
  const { data } = useRouteData<NewGameData>("/api/web/games/new");
  const { mod: formModule, error: formError } = useLazyModule(
    loadGameSettingsFormModule,
  );

  const FormComponent = formModule?.GameSettingsForm as
    | ComponentType<GameSettingsFormProps>
    | undefined;

  useEffect(() => {
    setHead(pageTitle("New Game"), "Play Go (Weiqi/Baduk) online with friends");
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
      <form
        id="new-game-form"
        action="/games"
        method="post"
        onSubmit={onSubmit}
      >
        {FormComponent ? (
          <FormComponent
            isRegistered={data?.user_is_registered}
            currentUserRank={data?.rating?.current_user_rank}
            rankedUnavailableReason={data?.rating?.ranked_unavailable_reason}
          />
        ) : (
          <LoadingState />
        )}
      </form>
    </>
  );
}

export function ChallengeScreen({
  username,
  navigate,
}: {
  username: string;
  navigate: NavigateFn;
}) {
  const { data } = useRouteData<NewGameData>(
    `/api/web/games/new?opponent=${encodeURIComponent(username)}`,
  );
  const { mod: formModule, error: formError } = useLazyModule(
    loadGameSettingsFormModule,
  );

  const FormComponent = formModule?.GameSettingsForm as
    | ComponentType<GameSettingsFormProps>
    | undefined;

  const oppRank = data?.opponent_rank;
  const oppRankText = fullRankText(oppRank);
  const oppLabel = oppRankText ? `${username} ${oppRankText}` : username;

  useEffect(() => {
    setHead(pageTitle(`Challenge ${oppLabel}`));
  }, [oppLabel]);

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
      <h1>Challenge {oppLabel}</h1>
      <form
        id="new-game-form"
        action="/games"
        method="post"
        onSubmit={onSubmit}
      >
        {FormComponent ? (
          <FormComponent
            opponent={data?.opponent ?? username}
            opponentRank={oppRank}
            isRegistered={data?.user_is_registered}
            currentUserRank={data?.rating?.current_user_rank}
            rankedUnavailableReason={data?.rating?.ranked_unavailable_reason}
          />
        ) : (
          <LoadingState />
        )}
      </form>
    </>
  );
}
