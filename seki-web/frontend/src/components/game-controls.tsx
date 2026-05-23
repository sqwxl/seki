import {
  ButtonContent,
  ConfirmButton,
  ModalConfirmPopover,
  type ControlsProps,
} from "./controls-shared";
import {
  IconAnalysis,
  IconPass,
  IconRepeat,
  IconUndo,
  IconWhiteFlag,
} from "./icons";

export function GameControls(props: ControlsProps) {
  return (
    <>
      {props.requestUndo && (
        <button
          title={props.requestUndo.title ?? "Undo"}
          disabled={props.requestUndo.disabled || props.requestUndo.pending}
          onClick={props.requestUndo.onClick}
        >
          <ButtonContent pending={props.requestUndo.pending} icon={IconUndo} />
        </button>
      )}
      {props.undoResponse ? (
        <ModalConfirmPopover
          icon={IconUndo}
          message="Opponent requests to undo their last move."
          onConfirm={props.undoResponse.onAccept}
          onCancel={props.undoResponse.onReject}
          pending={props.undoResponse.pending}
        />
      ) : null}
      {props.pass && !props.confirmPass && (
        <button
          class="btn-pass"
          title={props.pass.title ?? "Pass"}
          disabled={props.pass.disabled || props.pass.pending}
          onClick={props.pass.onClick}
        >
          <ButtonContent pending={props.pass.pending} icon={IconPass} />
        </button>
      )}
      {props.pass && props.confirmPass && (
        <ConfirmButton
          id="pass-btn"
          icon={IconPass}
          title={props.pass.title ?? "Pass"}
          disabled={props.pass.disabled}
          confirm={props.confirmPass}
          focusOnMount="cancel"
        />
      )}
      {props.resign && (
        <ConfirmButton
          id="resign-btn"
          icon={IconWhiteFlag}
          title="Resign"
          disabled={props.resign.disabled}
          confirm={props.resign}
          focusOnMount="cancel"
        />
      )}
      {props.rematch && (
        <ConfirmButton
          id="rematch-btn"
          icon={IconRepeat}
          title="Rematch"
          disabled={props.rematch.disabled}
          focusOnMount="confirm"
          confirm={{
            message: "Rematch?",
            onConfirm: () => {
              const swap =
                (document.getElementById("rematch-swap") as HTMLInputElement)
                  ?.checked ?? false;

              props.rematch!.onConfirm(swap);
            },
            pending: props.rematch.pending,
          }}
        >
          {!props.rematch.isRanked && (
            <label>
              <input type="checkbox" id="rematch-swap" /> Swap colors
            </label>
          )}
        </ConfirmButton>
      )}
      {props.controlRequestResponse ? (
        <ModalConfirmPopover
          icon={IconAnalysis}
          message={`${props.controlRequestResponse.displayName} requests control`}
          onConfirm={props.controlRequestResponse.onGive}
          onCancel={props.controlRequestResponse.onDismiss}
          pending={props.controlRequestResponse.pending}
        />
      ) : null}
    </>
  );
}
