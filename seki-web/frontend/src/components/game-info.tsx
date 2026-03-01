import { useRef } from "preact/hooks";
import type {
  ScoreData,
  UserData,
  GameSettings,
  TerritoryData,
  SettledTerritoryData,
} from "../game/types";
import { GameStage } from "../game/types";
import { getStatusText } from "./game-status";
import { IconInfo } from "./icons";
import {
  formatSize,
  formatTimeControl,
  blackSymbol,
  whiteSymbol,
} from "../utils/format";

export type GameInfoProps = {
  settings: GameSettings;
  komi: number;
  stage: GameStage;
  moveCount: number;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  capturesBlack: number;
  capturesWhite: number;
  territory: TerritoryData | undefined;
  settledTerritory: SettledTerritoryData | undefined;
  estimateScore: ScoreData | undefined;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function GameInfo(props: GameInfoProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = "game-info-popover";

  const { settings, komi } = props;
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);

  // Compact bar parts
  const parts = [size];
  if (settings.handicap >= 2) {
    parts.push(`H${settings.handicap}`);
  }
  if (tc) {
    parts.push(tc);
  }

  // Detail popover rows
  const statusText = getStatusText({
    stage: props.stage,
    result: props.result,
    komi,
    estimateScore: props.estimateScore,
    territoryScore: props.territory?.score,
  });

  const score =
    props.estimateScore ??
    props.territory?.score ??
    props.settledTerritory?.score;

  const tcLabel =
    settings.time_control !== "none" ? settings.time_control : undefined;
  const tcDetail = tc ? (tcLabel ? `${tc} (${tcLabel})` : tc) : undefined;

  const bName = props.black?.display_name ?? "?";
  const wName = props.white?.display_name ?? "?";

  const isDone =
    props.stage === GameStage.Completed || props.stage === GameStage.Aborted;

  return (
    <div class="game-info">
      <button class="game-info-bar" popovertarget={popoverId}>
        <IconInfo />
        <span>{parts.join(" · ")}</span>
      </button>
      <div id={popoverId} class="game-info-popover" popover ref={popoverRef}>
        <div class="game-info-popover-header">
          <IconInfo />
        </div>
        <dl class="game-info-details">
          {statusText && <Row label="Status" value={statusText} />}
          <Row label="Board" value={size} />
          <Row label="Komi" value={String(komi)} />
          {settings.handicap >= 2 && (
            <Row label="Handicap" value={String(settings.handicap)} />
          )}
          {tcDetail && <Row label="Time" value={tcDetail} />}
          <Row
            label="Black"
            value={`${bName} ${blackSymbol()} ${props.capturesBlack} caps`}
          />
          <Row
            label="White"
            value={`${wName} ${whiteSymbol()} ${props.capturesWhite} caps`}
          />
          <Row label="Moves" value={String(props.moveCount)} />
          {score && (
            <Row
              label="Territory"
              value={`B: ${score.black.territory} / W: ${score.white.territory}`}
            />
          )}
          {isDone && props.result && (
            <Row label="Result" value={props.result} />
          )}
        </dl>
      </div>
    </div>
  );
}
