import type { ChatEntry } from "../components/chat";
import type {
  DerivedHandicapKomi,
  InitialGameProps,
  RankData,
  UserData,
} from "../game/types";
import type { UserGamesInitialData } from "../layouts/user-games";
import type { FlashMessage } from "../utils/flash";

export type Route =
  | { kind: "games" }
  | { kind: "spectate" }
  | { kind: "players" }
  | { kind: "new-game" }
  | { kind: "challenge"; username: string }
  | {
      kind: "game";
      id: number;
      accessToken?: string | null;
      inviteToken?: string | null;
    }
  | { kind: "analysis" }
  | { kind: "profile"; username: string }
  | { kind: "login"; redirect?: string | null }
  | { kind: "register"; redirect?: string | null }
  | { kind: "settings" }
  | { kind: "not-found" };

export type FetchError = {
  status: number;
  message: string;
};

export type NavigateFn = (
  to: string,
  replace?: boolean,
  reload?: boolean,
  preserveFlash?: boolean,
) => void;

export type GamePageData = {
  game_id: number;
  game_props: InitialGameProps;
  chat_log: ChatEntry[];
  og_title: string;
  og_description: string;
};

export type NewGameData = {
  opponent?: string | null;
  user_is_registered: boolean;
  rating?: {
    can_create_ranked: boolean;
    current_user_rank?: RankData | null;
    ranked_unavailable_reason?: string | null;
  };
  opponent_rank?: RankData | null;
  derived_handicap_komi?: DerivedHandicapKomi | null;
};

export type RatingHistoryEntryData = {
  game_id: number;
  result: string;
  rating_before: number;
  rating_after: number;
  deviation_before: number;
  deviation_after: number;
  volatility_before: number;
  volatility_after: number;
  rating_delta: number;
  created_at: string;
  black_player?: string | null;
  white_player?: string | null;
  black_rank_before?: RankData | null;
  white_rank_before?: RankData | null;
  cols: number;
  rows: number;
  handicap: number;
  komi: number;
  time_control: "none" | "fischer" | "byoyomi" | "correspondence";
  main_time_secs?: number | null;
  increment_secs?: number | null;
  byoyomi_time_secs?: number | null;
  byoyomi_periods?: number | null;
};

export type ProfileStatsData = {
  total_games: number;
  rated_games: number;
  wins: number;
  losses: number;
  avg_opponent_rating: number | null;
  highest_rating: number | null;
  lowest_rating: number | null;
  time_spent_secs: number;
  win_streak_longest: number;
  win_streak_current: number;
  lose_streak_longest: number;
  lose_streak_current: number;
};

export type ProfileRatingData = {
  participating: boolean;
  rating: number;
  deviation: number;
  volatility: number;
  rank: RankData;
  rated_games: number;
  history: RatingHistoryEntryData[];
  stats: ProfileStatsData;
};

export type ProfileData = {
  profile_username: string;
  profile_user: UserData;
  rating?: ProfileRatingData | null;
  initial_games: UserGamesInitialData;
  is_own_profile: boolean;
  api_token?: string | null;
  user_email?: string | null;
  user_is_registered: boolean;
};

export type PlayerDirectoryItem = {
  user: UserData;
  is_online: boolean;
  wins: number;
  losses: number;
  rating_trend: number[];
  last_active_at: string;
};

export type PlayersData = {
  players: PlayerDirectoryItem[];
  offset: number;
  limit: number;
  has_more: boolean;
};

export type BootstrapPayload = {
  url?: string;
  data?: unknown;
  flash?: FlashMessage;
};

export type GameSettingsFormProps = {
  opponent?: string;
  opponentRank?: RankData | null;
  isRegistered?: boolean;
  currentUserRank?: RankData | null;
  rankedUnavailableReason?: string | null;
  derivedHandicapKomi?: DerivedHandicapKomi | null;
};
