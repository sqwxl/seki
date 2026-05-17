import type { GameSettings } from "../game/types";
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
          {yourColor && (
            <>
              <dt>Your color</dt>
              <dd>{yourColor}</dd>
            </>
          )}
          <dt>Board</dt>
          <dd>{size}</dd>
          <dt>Komi</dt>
          <dd>{String(komi)}</dd>
          <dt>Handicap</dt>
          <dd>{settings.handicap >= 2 ? String(settings.handicap) : "None"}</dd>
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
                {variant === "visitor-open" && (
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
