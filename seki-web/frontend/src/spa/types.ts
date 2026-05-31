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
};

export type ProfileRatingData = {
  participating: boolean;
  rating: number;
  deviation: number;
  volatility: number;
  rank: RankData;
  rated_games: number;
  history: RatingHistoryEntryData[];
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
