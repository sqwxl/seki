import { useEffect, useState } from "preact/hooks";
import type { GameSettings, PregameSettingsData } from "../game/types";
import { formatSize, formatTimeControl } from "../utils/format";
import {
  ButtonContent,
  ConfirmModal,
  CopyInviteLinkButton,
} from "./controls-shared";
import { IconStonesBw } from "./icons";

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
  const showRatingRange = settings.rating_range_mode != null;
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
  playerStone,
  isCreator,
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
  playerStone: number;
  isCreator: boolean;
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining =
    pregame.expires_at == null
      ? undefined
      : Math.max(
          0,
          Math.ceil((new Date(pregame.expires_at).getTime() - now) / 1000),
        );
  const currentPlayerApproved =
    (playerStone === 1 && pregame.black_approved) ||
    (playerStone === -1 && pregame.white_approved);
  const anyPlayerApproved = pregame.black_approved || pregame.white_approved;
  const acceptLabel = anyPlayerApproved
    ? `Accepted${remaining == null ? "" : ` (${remaining}s)`}`
    : "Accept";
  const acceptDisabled =
    disabled || pendingAction != null || currentPlayerApproved;
  const rejectDisabled = disabled || pendingAction != null;
  const submit = (patch: Partial<PregameSettingsData>) => {
    onUpdate({
      handicap: patch.handicap ?? pregame.handicap,
      komi: patch.komi ?? pregame.komi,
      color: patch.color ?? pregame.color,
    });
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

  return (
    <ConfirmModal open dismissible={false}>
      <div id="lobby-popover" class="confirm-popover">
        <IconStonesBw />
        <p>
          <strong>{title}</strong>
        </p>
        <dl class="game-info-details" style="margin-top: 0.5em">
          <dt>Rated</dt>
          <dd>No</dd>
          <dt>Board</dt>
          <dd>{size}</dd>
          <dt>Komi</dt>
          <dd>
            <input
              type="number"
              min={-99.5}
              step={1}
              value={pregame.komi}
              disabled={disabled}
              onChange={(e) => submit({ komi: Number(e.currentTarget.value) })}
            />
          </dd>
          <dt>Handicap</dt>
          <dd>
            <input
              type="number"
              min={0}
              step={1}
              value={pregame.handicap}
              disabled={disabled}
              onChange={(e) =>
                submit({ handicap: parseInt(e.currentTarget.value, 10) || 0 })
              }
            />
          </dd>
          <dt>Your color</dt>
          <dd>
            <select
              value={pregame.color}
              disabled={disabled}
              onChange={(e) =>
                submit({
                  color: e.currentTarget.value as "black" | "white" | "random",
                })
              }
            >
              <option value="black">{colorLabel("black")}</option>
              <option value="white">{colorLabel("white")}</option>
              <option value="random">{colorLabel("random")}</option>
            </select>
          </dd>
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
