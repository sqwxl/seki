import { useEffect, useRef, useState } from "preact/hooks";
import type {
  GameSettings,
  PregameSettingsData,
  UserData,
} from "../game/types";
import { formatSize, formatTimeControl } from "../utils/format";
import {
  ButtonContent,
  ConfirmModal,
  CopyInviteLinkButton,
  HandicapSelect,
} from "./controls-shared";
import { IconCheck, IconStonesBw } from "./icons";
import { UserLabel } from "./user-label";

export function LobbyPopover({
  variant,
  title,
  settings,
  komi,
  allowUndo,
  rated = false,
  yourColor,
  pendingAction,
  canJoin = true,
  showAbort = false,
  isSpectating = false,
  onAccept,
  onDecline,
  onAbort,
  onJoin,
  onSpectate,
  onCancelSpectate,
  copyInviteLink,
}: {
  variant:
    | "creator-waiting"
    | "creator-challenge"
    | "challengee"
    | "visitor-open"
    | "visitor-challenge";
  title: string;
  settings: GameSettings;
  komi: number;
  allowUndo: boolean;
  rated?: boolean;
  yourColor?: "Black" | "White" | "Random";
  pendingAction?: "accept" | "decline" | "abort" | "join";
  canJoin?: boolean;
  showAbort?: boolean;
  isSpectating?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onAbort?: () => void;
  onJoin?: () => void;
  onSpectate?: () => void;
  onCancelSpectate?: () => void;
  copyInviteLink?: () => void;
}) {
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);
  const disableActions = pendingAction != null;
  const isOpenGame =
    variant === "creator-waiting" || variant === "visitor-open";
  const showRatingRange = isOpenGame && settings.rating_range_mode != null;
  const ratingRangeText =
    settings.rating_difference_lower_unlimited &&
    settings.rating_difference_higher_unlimited
      ? "Unlimited"
      : settings.max_rating_difference_lower ===
          settings.max_rating_difference_higher
        ? String(settings.max_rating_difference_lower)
        : `${settings.max_rating_difference_lower ?? "Unlimited"} / ${settings.max_rating_difference_higher ?? "Unlimited"}`;

  return (
    <ConfirmModal open dismissible={false}>
      <div id="lobby-popover" class="confirm-popover">
        <IconStonesBw />
        <p>
          <strong>{title}</strong>
        </p>
        <dl class="game-info-details" style="margin-top: 0.5em">
          <dt>Rated</dt>
          <dd>{rated ? "Yes" : "No"}</dd>
          {showRatingRange ? (
            <>
              <dt>Max rating difference</dt>
              <dd>{ratingRangeText}</dd>
            </>
          ) : (
            yourColor && (
              <>
                <dt>Your color</dt>
                <dd>{yourColor}</dd>
              </>
            )
          )}
          <dt>Board</dt>
          <dd>{size}</dd>
          {!showRatingRange && (
            <>
              <dt>Komi</dt>
              <dd>{String(komi)}</dd>
              <dt>Handicap</dt>
              <dd>
                {settings.handicap >= 2 ? String(settings.handicap) : "None"}
              </dd>
            </>
          )}
          <dt>Time</dt>
          <dd>{tc || "Unlimited"}</dd>
          <dt>Takebacks</dt>
          <dd>{allowUndo ? "Yes" : "No"}</dd>
        </dl>
        <div class="confirm-actions">
          {variant === "challengee" && (
            <>
              <button
                class="btn-success"
                disabled={disableActions}
                onClick={onAccept}
              >
                <ButtonContent
                  pending={pendingAction === "accept"}
                  label="Accept"
                />
              </button>
              <button
                class="btn-warn"
                disabled={disableActions}
                onClick={onDecline}
              >
                <ButtonContent
                  pending={pendingAction === "decline"}
                  label="Decline"
                />
              </button>
            </>
          )}
          {(variant === "visitor-open" || variant === "visitor-challenge") &&
            !isSpectating && (
              <>
                {variant === "visitor-open" && canJoin && (
                  <button
                    class="btn-success"
                    disabled={disableActions}
                    onClick={onJoin}
                  >
                    <ButtonContent
                      pending={pendingAction === "join"}
                      label="Join"
                    />
                  </button>
                )}
                <button disabled={disableActions} onClick={onSpectate}>
                  <ButtonContent label="Spectate" />
                </button>
              </>
            )}
          {(variant === "visitor-open" || variant === "visitor-challenge") &&
            isSpectating && (
              <>
                <p>You are spectating</p>
                <button
                  class="btn-warn"
                  disabled={disableActions}
                  onClick={onCancelSpectate}
                >
                  <ButtonContent label="Cancel" />
                </button>
              </>
            )}
          {(variant === "creator-waiting" ||
            variant === "creator-challenge") && (
            <>
              {copyInviteLink && (
                <CopyInviteLinkButton onClick={copyInviteLink} />
              )}
              {showAbort && (
                <button
                  class="btn-warn"
                  disabled={disableActions}
                  onClick={onAbort}
                >
                  <ButtonContent
                    pending={pendingAction === "abort"}
                    label="Abort"
                  />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </ConfirmModal>
  );
}

export function PregameSettingsPopover({
  title,
  settings,
  pregame,
  allowUndo,
  disabled,
  isCreator,
  creator,
  joiner,
  pendingAction,
  onUpdate,
  onAccept,
  onReject,
}: {
  title: string;
  settings: GameSettings;
  pregame: PregameSettingsData;
  allowUndo: boolean;
  disabled: boolean;
  isCreator: boolean;
  creator: UserData | undefined;
  joiner: UserData | undefined;
  pendingAction?: "accept" | "reject";
  onUpdate: (settings: {
    handicap: number;
    komi: number;
    color: "black" | "white" | "random";
  }) => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);
  const opponent = isCreator ? joiner : creator;
  const currentPlayerApproved = isCreator
    ? pregame.black_approved
    : pregame.white_approved;
  const opponentApproved = isCreator
    ? pregame.white_approved
    : pregame.black_approved;
  const acceptLabel = currentPlayerApproved ? "Accepted" : "Accept";
  const acceptDisabled =
    disabled || pendingAction != null || currentPlayerApproved;
  const rejectDisabled = disabled || pendingAction != null;
  const lastSubmittedKomi = useRef(pregame.komi);
  const lastSubmittedHandicap = useRef(pregame.handicap);
  const lastSubmittedColor = useRef(pregame.color);

  const submit = (patch: Partial<PregameSettingsData>) => {
    const komi = patch.komi ?? pregame.komi;
    const handicap = patch.handicap ?? pregame.handicap;
    const color = patch.color ?? pregame.color;
    lastSubmittedKomi.current = komi;
    lastSubmittedHandicap.current = handicap;
    lastSubmittedColor.current = color;
    onUpdate({ handicap, komi, color });
  };
  const colorLabel = (value: "black" | "white" | "random") => {
    if (value === "random") {
      return "Random";
    }
    if (!isCreator) {
      return value === "black" ? "White" : "Black";
    }
    return value === "black" ? "Black" : "White";
  };

  const prevKomi = useRef(pregame.komi);
  const prevHandicap = useRef(pregame.handicap);
  const prevColor = useRef(pregame.color);
  const [komiFlash, setKomiFlash] = useState(false);
  const [handicapFlash, setHandicapFlash] = useState(false);
  const [colorFlash, setColorFlash] = useState(false);
  useEffect(() => {
    if (prevKomi.current !== pregame.komi) {
      if (pregame.komi !== lastSubmittedKomi.current) {
        setKomiFlash(true);
        const t = setTimeout(() => setKomiFlash(false), 1000);
        prevKomi.current = pregame.komi;
        return () => clearTimeout(t);
      }
    }
    prevKomi.current = pregame.komi;
  }, [pregame.komi]);
  useEffect(() => {
    if (prevHandicap.current !== pregame.handicap) {
      if (pregame.handicap !== lastSubmittedHandicap.current) {
        setHandicapFlash(true);
        const t = setTimeout(() => setHandicapFlash(false), 1000);
        prevHandicap.current = pregame.handicap;
        return () => clearTimeout(t);
      }
    }
    prevHandicap.current = pregame.handicap;
  }, [pregame.handicap]);
  useEffect(() => {
    if (prevColor.current !== pregame.color) {
      if (pregame.color !== lastSubmittedColor.current) {
        setColorFlash(true);
        const t = setTimeout(() => setColorFlash(false), 1000);
        prevColor.current = pregame.color;
        return () => clearTimeout(t);
      }
    }
    prevColor.current = pregame.color;
  }, [pregame.color]);

  return (
    <ConfirmModal open dismissible={false}>
      <div id="lobby-popover" class="confirm-popover">
        <IconStonesBw />
        <p>
          <strong>{title}</strong>
        </p>
        <dl class="game-info-details" style="margin-top: 0.5em">
          {!disabled && (
            <>
              <dt>Opponent</dt>
              <dd>
                <span class="pregame-opponent-status">
                  {opponent ? <UserLabel user={opponent} /> : "Opponent"}
                  {opponentApproved && <IconCheck title="Accepted" />}
                </span>
              </dd>
            </>
          )}
          <dt>Rated</dt>
          <dd>No</dd>
          <dt>Board</dt>
          <dd>{size}</dd>
          <dt>Komi</dt>
          <dd class={komiFlash ? "form-value-sync" : undefined}>
            {disabled ? (
              pregame.komi
            ) : (
              <input
                type="number"
                min={-99.5}
                step={1}
                value={pregame.komi}
                disabled={disabled}
                onChange={(e) =>
                  submit({ komi: Number(e.currentTarget.value) })
                }
              />
            )}
          </dd>
          <dt>Handicap</dt>
          <dd class={handicapFlash ? "form-value-sync" : undefined}>
            {disabled ? (
              pregame.handicap || "None"
            ) : (
              <HandicapSelect
                value={pregame.handicap}
                max={pregame.max_handicap}
                disabled={disabled}
                onChange={(handicap) => {
                  submit(
                    handicap >= 2 ? { handicap, komi: 0.5 } : { handicap },
                  );
                }}
              />
            )}
          </dd>
          {disabled ? (
            <>
              <dt>Black</dt>
              <dd class={colorFlash ? "form-value-sync" : undefined}>
                {pregame.color === "black"
                  ? (creator?.display_name ?? "?")
                  : pregame.color === "white"
                    ? (joiner?.display_name ?? "?")
                    : "?"}
              </dd>
            </>
          ) : (
            <>
              <dt>Your color</dt>
              <dd class={colorFlash ? "form-value-sync" : undefined}>
                <select
                  value={pregame.color}
                  disabled={disabled}
                  onChange={(e) =>
                    submit({
                      color: e.currentTarget.value as
                        | "black"
                        | "white"
                        | "random",
                    })
                  }
                >
                  <option value="black">{colorLabel("black")}</option>
                  <option value="white">{colorLabel("white")}</option>
                  <option value="random">{colorLabel("random")}</option>
                </select>
              </dd>
            </>
          )}
          <dt>Time</dt>
          <dd>{tc || "Unlimited"}</dd>
          <dt>Takebacks</dt>
          <dd>{allowUndo ? "Yes" : "No"}</dd>
        </dl>
        <div class="confirm-actions">
          <button disabled={acceptDisabled} onClick={onAccept}>
            <ButtonContent
              pending={pendingAction === "accept"}
              label={acceptLabel}
            />
          </button>
          <button class="btn-warn" disabled={rejectDisabled} onClick={onReject}>
            <ButtonContent
              pending={pendingAction === "reject"}
              label="Reject"
            />
          </button>
        </div>
      </div>
    </ConfirmModal>
  );
}
