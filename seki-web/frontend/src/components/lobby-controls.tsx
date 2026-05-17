import { ConfirmButton, type ControlsProps } from "./controls-shared";
import { IconCancel, IconWhiteFlag } from "./icons";

export function LobbyControls(props: ControlsProps) {
  const hasAny = props.abort || props.claimVictory;

  if (!hasAny) {
    return null;
  }

  return (
    <div class="lobby-controls">
      {props.abort && (
        <ConfirmButton
          id="abort-btn"
          icon={IconCancel}
          title="Abort game"
          disabled={props.abort.disabled}
          confirm={props.abort}
          buttonClass="btn-warn"
        />
      )}
      {props.claimVictory && (
        <ConfirmButton
          id="claim-victory-btn"
          icon={IconWhiteFlag}
          title="Claim victory (opponent left)"
          disabled={props.claimVictory.disabled}
          confirm={props.claimVictory}
          buttonClass="btn-success"
        />
      )}
    </div>
  );
}
