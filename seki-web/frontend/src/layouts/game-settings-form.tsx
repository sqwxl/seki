import { useEffect, useRef, useState } from "preact/hooks";
import { IconBell, IconTimer, IconUser } from "../components/icons";
import type { DerivedHandicapKomi, RankData } from "../game/types";
import { fullRankText } from "../utils/rating";
import { GAME_SETTINGS, storage } from "../utils/storage";
import {
  CHALLENGE_DEFAULTS,
  DirectChallengeForm,
  type ChallengeSettings,
} from "./form-variants/direct-challenge";
import {
  EMAIL_DEFAULTS,
  EmailInviteForm,
  type EmailInviteSettings,
} from "./form-variants/email-invite";
import {
  OPEN_DEFAULTS,
  OpenGameForm,
  type OpenGameSettings,
} from "./form-variants/open-game";
import {
  OpponentSelect,
  type OpponentSearchResult,
} from "./form-variants/shared";

type TimeControl = "none" | "fischer" | "byoyomi" | "correspondence";
type Variant = "open" | "challenge" | "email";

type SharedSettings = {
  timeControl: TimeControl;
  mainTimeMinutes: number;
  incrementSecs: number;
  byoMainTimeMinutes: number;
  byoyomiTimeSecs: number;
  byoyomiPeriods: number;
  correspondenceDays: number;
  creatorEmail: string;
  variant: Variant;
};

const SHARED_DEFAULTS: SharedSettings = {
  timeControl: "none",
  mainTimeMinutes: 10,
  incrementSecs: 5,
  byoMainTimeMinutes: 20,
  byoyomiTimeSecs: 30,
  byoyomiPeriods: 3,
  correspondenceDays: 3,
  creatorEmail: "",
  variant: "open",
};

type AllSettings = {
  shared: SharedSettings;
  open: OpenGameSettings;
  challenge: ChallengeSettings;
  email: EmailInviteSettings;
};

type CommonSettingKey =
  | "cols"
  | "handicap"
  | "komi"
  | "color"
  | "allowUndo"
  | "isPrivate";

const COMMON_SETTING_KEYS: CommonSettingKey[] = [
  "cols",
  "handicap",
  "komi",
  "color",
  "allowUndo",
  "isPrivate",
];

function isCommonSettingKey(key: string): key is CommonSettingKey {
  return COMMON_SETTING_KEYS.includes(key as CommonSettingKey);
}

function applyCommonSetting(
  all: AllSettings,
  source: Variant,
  key: CommonSettingKey,
  value: OpenGameSettings[CommonSettingKey],
): AllSettings {
  const open = { ...all.open };
  const challenge = { ...all.challenge };
  const email = { ...all.email };

  if (key === "cols") {
    open.cols = value as number;
    challenge.cols = value as number;
    email.cols = value as number;
  } else if (key === "handicap") {
    open.handicap = value as number;
    challenge.handicap = value as number;
    email.handicap = value as number;
  } else if (key === "komi") {
    open.komi = value as number;
    challenge.komi = value as number;
    email.komi = value as number;
  } else if (key === "color") {
    open.color = value as string;
    challenge.color = value as string;
    email.color = value as string;
  } else if (key === "allowUndo") {
    open.allowUndo = value as boolean;
    challenge.allowUndo = value as boolean;
    email.allowUndo = value as boolean;
  } else if (key === "isPrivate") {
    const isPrivate = value as boolean;
    open.isPrivate = open.ranked ? false : isPrivate;
    challenge.isPrivate = challenge.ranked ? false : isPrivate;
    email.isPrivate = isPrivate;
  }

  if (source === "open") {
    return { ...all, open, challenge, email };
  }

  if (source === "challenge") {
    return { ...all, challenge, open, email };
  }

  return { ...all, email, open, challenge };
}

function syncFromVariant(all: AllSettings, source: Variant): AllSettings {
  const sourceSettings = all[source];
  return COMMON_SETTING_KEYS.reduce(
    (next, key) => applyCommonSetting(next, source, key, sourceSettings[key]),
    all,
  );
}

function normalizeSettings(all: AllSettings): AllSettings {
  return syncFromVariant(all, all.shared.variant);
}

function loadSettings(): AllSettings {
  try {
    const saved = storage.getJson<Partial<AllSettings>>(GAME_SETTINGS);

    if (saved) {
      return normalizeSettings({
        shared: { ...SHARED_DEFAULTS, ...saved.shared },
        open: { ...OPEN_DEFAULTS, ...saved.open },
        challenge: { ...CHALLENGE_DEFAULTS, ...saved.challenge },
        email: { ...EMAIL_DEFAULTS, ...saved.email },
      });
    }
  } catch {}

  return normalizeSettings({
    shared: { ...SHARED_DEFAULTS },
    open: { ...OPEN_DEFAULTS },
    challenge: { ...CHALLENGE_DEFAULTS },
    email: { ...EMAIL_DEFAULTS },
  });
}

type Props = {
  opponent?: string;
  opponentRank?: RankData | null;
  isRegistered?: boolean;
  currentUserRank?: RankData | null;
  rankedUnavailableReason?: string | null;
  derivedHandicapKomi?: DerivedHandicapKomi | null;
};

export function GameSettingsForm({
  opponent,
  opponentRank,
  isRegistered,
  currentUserRank,
  rankedUnavailableReason,
  derivedHandicapKomi: initialDerivedHandicapKomi,
}: Props) {
  const [all, setAll] = useState(() => {
    const saved = loadSettings();

    if (opponent) {
      saved.shared.variant = "challenge";
      saved.challenge.selectedOpponent = opponent;

      const canRank =
        opponentRank?.status === "ranked" ||
        opponentRank?.status === "unranked";

      if (canRank && isRegistered && !rankedUnavailableReason) {
        saved.challenge.ranked = true;
      }
    }

    return saved;
  });
  const [selectedChallengeOpponentRank, setSelectedChallengeOpponentRank] =
    useState<RankData | null | undefined>(opponentRank);
  const [searchDerivedHandicapKomi, setSearchDerivedHandicapKomi] = useState<
    DerivedHandicapKomi | null | undefined
  >(initialDerivedHandicapKomi);

  const settingsRef = useRef(all);
  settingsRef.current = all;
  const rootRef = useRef<HTMLDivElement>(null);

  const variant = all.shared.variant;
  const shared = all.shared;
  const challengeOpponentRank = opponent
    ? opponentRank
    : selectedChallengeOpponentRank;
  const currentRatingText = fullRankText(currentUserRank);
  const isRanked =
    variant === "email"
      ? false
      : variant === "open"
        ? all.open.ranked
        : all.challenge.ranked;

  function setVariant(v: Variant) {
    setAll((prev) => {
      const synced = syncFromVariant(prev, prev.shared.variant);

      return { ...synced, shared: { ...synced.shared, variant: v } };
    });
  }

  function setShared<K extends keyof SharedSettings>(
    key: K,
    value: SharedSettings[K],
  ) {
    if (key === "timeControl" && value === "none" && isRanked) {
      return;
    }

    setAll((prev) => ({ ...prev, shared: { ...prev.shared, [key]: value } }));
  }

  function setOpen<K extends keyof OpenGameSettings>(
    key: K,
    value: OpenGameSettings[K],
  ) {
    setAll((prev) => {
      const commonKey = String(key);
      if (isCommonSettingKey(commonKey)) {
        return applyCommonSetting(
          prev,
          "open",
          commonKey,
          value as OpenGameSettings[CommonSettingKey],
        );
      }

      const next = { ...prev.open, [key]: value };

      return { ...prev, open: next };
    });
  }

  function setChallenge<K extends keyof ChallengeSettings>(
    key: K,
    value: ChallengeSettings[K],
  ) {
    setAll((prev) => {
      const commonKey = String(key);
      if (isCommonSettingKey(commonKey)) {
        return applyCommonSetting(
          prev,
          "challenge",
          commonKey,
          value as OpenGameSettings[CommonSettingKey],
        );
      }

      const next = { ...prev.challenge, [key]: value };

      return { ...prev, challenge: next };
    });
  }

  function setEmail<K extends keyof EmailInviteSettings>(
    key: K,
    value: EmailInviteSettings[K],
  ) {
    setAll((prev) => {
      const commonKey = String(key);
      if (isCommonSettingKey(commonKey)) {
        return applyCommonSetting(
          prev,
          "email",
          commonKey,
          value as OpenGameSettings[CommonSettingKey],
        );
      }

      return { ...prev, email: { ...prev.email, [key]: value } };
    });
  }

  function setChallengeOpponent(result: OpponentSearchResult | null) {
    const opponentRank = result?.user_data.rank ?? null;
    setSelectedChallengeOpponentRank(opponentRank);
    setSearchDerivedHandicapKomi(result?.derived_handicap_komi ?? null);
    setAll((prev) => {
      return {
        ...prev,
        challenge: {
          ...prev.challenge,
          selectedOpponent: result?.user_data.display_name ?? "",
        },
      };
    });
  }

  useEffect(() => {
    const form = rootRef.current?.closest("form");

    if (!form) {
      return;
    }

    const onSubmit = () => {
      try {
        storage.setJson(GAME_SETTINGS, settingsRef.current);
      } catch {}
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
        e.preventDefault();

        const inputs = Array.from(
          form.querySelectorAll<HTMLElement>(
            "input:not([hidden]):not([disabled]), select:not([disabled]), button:not([disabled])",
          ),
        );
        const idx = inputs.indexOf(e.target as HTMLElement);

        if (idx >= 0 && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      }
    };
    form.addEventListener("submit", onSubmit);
    form.addEventListener("keydown", onKeydown);

    return () => {
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("keydown", onKeydown);
    };
  }, []);

  const tcActive = (tc: string) => shared.timeControl === tc;

  const submitText =
    variant === "challenge" && all.challenge.selectedOpponent
      ? "Challenge"
      : opponent
        ? "Challenge"
        : "Create Game";
  const submitDisabled =
    variant === "challenge" && !all.challenge.selectedOpponent;

  return (
    <div ref={rootRef}>
      {!opponent && (
        <fieldset>
          <legend>
            <IconUser /> Opponent
          </legend>
          <div class="opponent-mode-radios">
            <label>
              <input
                type="radio"
                name="_variant"
                checked={variant === "open"}
                onChange={() => setVariant("open")}
              />
              Open game
            </label>
            <label>
              <input
                type="radio"
                name="_variant"
                checked={variant === "challenge"}
                onChange={() => setVariant("challenge")}
              />
              Direct challenge
            </label>
            <label>
              <input
                type="radio"
                name="_variant"
                checked={variant === "email"}
                onChange={() => setVariant("email")}
              />
              Email invite
            </label>
          </div>
          {variant === "challenge" && (
            <OpponentSelect
              selectedOpponent={all.challenge.selectedOpponent}
              setSelectedOpponent={(username) =>
                setChallenge("selectedOpponent", username)
              }
              opponentRank={challengeOpponentRank}
              rated={all.challenge.ranked}
              onSelectOpponent={setChallengeOpponent}
            />
          )}
          {variant === "email" && (
            <>
              <div>
                <label for="invite_email">Email address</label>
                <input
                  type="email"
                  name="invite_email"
                  id="invite_email"
                  placeholder="friend@email.com"
                  value={all.email.inviteEmail}
                  required
                  onInput={(e) =>
                    setEmail("inviteEmail", e.currentTarget.value)
                  }
                />
              </div>

              <div>
                <label for="invite_message">Message (optional)</label>
                <textarea
                  name="invite_message"
                  id="invite_message"
                  placeholder="Hey, let's play Go!"
                  value={all.email.inviteMessage}
                  onInput={(e) =>
                    setEmail("inviteMessage", e.currentTarget.value)
                  }
                  rows={3}
                />
              </div>
            </>
          )}
        </fieldset>
      )}

      <input type="hidden" name="variant" value={variant} />
      {variant === "challenge" && (
        <input
          type="hidden"
          name="invite_username"
          value={all.challenge.selectedOpponent}
        />
      )}

      {variant === "open" && (
        <OpenGameForm
          s={all.open}
          set={setOpen}
          isRegistered={isRegistered}
          rankedUnavailableReason={rankedUnavailableReason}
          currentRatingText={currentRatingText}
        />
      )}

      {variant === "challenge" && (
        <DirectChallengeForm
          s={all.challenge}
          set={setChallenge}
          isRegistered={isRegistered}
          derivedHandicapKomi={searchDerivedHandicapKomi}
          currentUserRank={currentUserRank}
          opponentRank={challengeOpponentRank}
          rankedUnavailableReason={rankedUnavailableReason}
          currentRatingText={currentRatingText}
        />
      )}

      {variant === "email" && <EmailInviteForm s={all.email} set={setEmail} />}

      <fieldset>
        <legend>
          <IconTimer /> Time control
        </legend>
        <div class="new-game-form-time-controls">
          {!isRanked && (
            <label>
              <input
                type="radio"
                name="_time_control"
                value="none"
                checked={tcActive("none")}
                onChange={() => setShared("timeControl", "none")}
              />
              None
            </label>
          )}
          <label>
            <input
              type="radio"
              name="_time_control"
              value="fischer"
              checked={tcActive("fischer")}
              onChange={() => setShared("timeControl", "fischer")}
            />
            Fischer
          </label>
          <label>
            <input
              type="radio"
              name="_time_control"
              value="byoyomi"
              checked={tcActive("byoyomi")}
              onChange={() => setShared("timeControl", "byoyomi")}
            />
            Byo-yomi
          </label>
          <label>
            <input
              type="radio"
              name="_time_control"
              value="correspondence"
              checked={tcActive("correspondence")}
              onChange={() => setShared("timeControl", "correspondence")}
            />
            Correspondence
          </label>
        </div>
        <input type="hidden" name="time_control" value={shared.timeControl} />

        <div
          id="tc-fischer"
          style={{ display: tcActive("fischer") ? "" : "none" }}
        >
          <div>
            <label for="main_time_minutes">Main time (minutes)</label>
            <input
              type="number"
              name="main_time_minutes"
              id="main_time_minutes"
              min={1}
              max={180}
              value={shared.mainTimeMinutes}
              disabled={!tcActive("fischer")}
              onChange={(e) =>
                setShared(
                  "mainTimeMinutes",
                  parseInt(e.currentTarget.value, 10) || 10,
                )
              }
            />
          </div>
          <div>
            <label for="increment_secs">Increment (seconds)</label>
            <input
              type="number"
              name="increment_secs"
              id="increment_secs"
              min={0}
              max={60}
              value={shared.incrementSecs}
              disabled={!tcActive("fischer")}
              onChange={(e) =>
                setShared(
                  "incrementSecs",
                  parseInt(e.currentTarget.value, 10) || 5,
                )
              }
            />
          </div>
        </div>

        <div
          id="tc-byoyomi"
          style={{ display: tcActive("byoyomi") ? "" : "none" }}
        >
          <div>
            <label for="byo_main_time_minutes">Main time (minutes)</label>
            <input
              type="number"
              name="main_time_minutes"
              id="byo_main_time_minutes"
              min={0}
              max={180}
              value={shared.byoMainTimeMinutes}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                setShared(
                  "byoMainTimeMinutes",
                  parseInt(e.currentTarget.value, 10) || 20,
                )
              }
            />
          </div>
          <div>
            <label for="byoyomi_time_secs">Period time (seconds)</label>
            <input
              type="number"
              name="byoyomi_time_secs"
              id="byoyomi_time_secs"
              min={5}
              max={120}
              value={shared.byoyomiTimeSecs}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                setShared(
                  "byoyomiTimeSecs",
                  parseInt(e.currentTarget.value, 10) || 30,
                )
              }
            />
          </div>
          <div>
            <label for="byoyomi_periods">Periods</label>
            <input
              type="number"
              name="byoyomi_periods"
              id="byoyomi_periods"
              min={1}
              max={10}
              value={shared.byoyomiPeriods}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                setShared(
                  "byoyomiPeriods",
                  parseInt(e.currentTarget.value, 10) || 3,
                )
              }
            />
          </div>
        </div>

        <div
          id="tc-correspondence"
          style={{ display: tcActive("correspondence") ? "" : "none" }}
        >
          <div>
            <label for="correspondence_days">Days per move</label>
            <input
              type="number"
              name="correspondence_days"
              id="correspondence_days"
              min={1}
              max={30}
              value={shared.correspondenceDays}
              disabled={!tcActive("correspondence")}
              onChange={(e) =>
                setShared(
                  "correspondenceDays",
                  parseInt(e.currentTarget.value, 10) || 3,
                )
              }
            />
          </div>
        </div>
      </fieldset>

      {!opponent && tcActive("correspondence") && (
        <fieldset>
          <legend>
            <IconBell /> Notifications
          </legend>
          <div>
            <label for="creator_email">
              Get notified when it's your turn to play (optional)
            </label>
            <input
              type="email"
              name="creator_email"
              id="creator_email"
              placeholder="your@email.com"
              value={shared.creatorEmail}
              onInput={(e) => setShared("creatorEmail", e.currentTarget.value)}
            />
          </div>
        </fieldset>
      )}

      <button type="submit" disabled={submitDisabled}>
        {submitText}
      </button>
    </div>
  );
}
