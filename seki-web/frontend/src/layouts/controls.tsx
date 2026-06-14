import { ControlsMenu } from "../components/controls-menu";
import { type ControlsProps } from "../components/controls-shared";
import { GameControls } from "../components/game-controls";
import { IconCheck, IconX } from "../components/icons";
import { NavControls } from "../components/nav-controls";
import { hasCollapsedUiControls, UIControls } from "../components/ui-controls";

export function Controls(props: ControlsProps) {
  const reviewing = props.layout === "analysis-review";

  if (reviewing) {
    const reviewOverride = props.territoryReady
      ? {
          onClick: props.territoryReady.onClick,
          disabled: props.territoryReady.disabled,
          title: "Accept territory",
          content: <IconCheck />,
        }
      : undefined;

    return (
      <div class="controls-group">
        {props.nav && (
          <NavControls nav={props.nav} counterOverride={reviewOverride} />
        )}
        {props.territoryExit && (
          <button class="btn-exit" onClick={props.territoryExit.onClick}>
            <IconX />
          </button>
        )}
      </div>
    );
  }

  const counterOverride = props.confirmMove
    ? {
        onClick: props.confirmMove.onClick,
        disabled: props.confirmMove.disabled,
        title: "Confirm move",
        content: <IconCheck />,
      }
    : props.acceptTerritory
      ? {
          onClick: props.acceptTerritory.onClick,
          disabled: props.acceptTerritory.disabled,
          title: "Accept territory",
          content: <IconCheck />,
        }
      : undefined;

  return (
    <div class={`controls-row${props.compact ? " controls-row--compact" : ""}`}>
      <span class="btn-group controls-start">
        <GameControls {...props} />
      </span>
      <span class="btn-group controls-middle">
        {props.nav ? (
          <NavControls
            nav={props.nav}
            counterOverride={counterOverride}
            compact={props.compact}
          />
        ) : counterOverride ? (
          <button
            class="btn-raised controls-counter controls-confirm"
            title={counterOverride.title}
            disabled={counterOverride.disabled}
            onClick={counterOverride.onClick}
          >
            {counterOverride.content}
          </button>
        ) : null}
      </span>
      <span class="btn-group controls-end">
        <UIControls {...props} excludeAnalysis={props.compact} />
        {props.compact &&
          hasCollapsedUiControls(props, { excludeAnalysis: true }) && (
            <ControlsMenu>
              <UIControls {...props} excludeAnalysis renderMode="menu" />
            </ControlsMenu>
          )}
      </span>
    </div>
  );
}
