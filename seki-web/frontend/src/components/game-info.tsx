import { useEffect, useRef, useState } from "preact/hooks";
import type {
  GameSettings,
  ScoreData,
  SettledTerritoryData,
  TerritoryData,
  UserData,
} from "../game/types";
import { GameStage } from "../game/types";
import {
  blackSymbol,
  formatSize,
  formatTimeControl,
  whiteSymbol,
} from "../utils/format";
import { ratingDisplayPreference } from "../utils/preferences";
import { primaryRankText } from "../utils/rating";
import { getStatusText } from "./game-status";
import { IconInfo } from "./icons";

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
  copyInviteLink: () => void;
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);

  const { settings, komi } = props;
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);
  const ratingMode = ratingDisplayPreference.value;
  const blackRank = primaryRankText(props.black?.rank, ratingMode);
  const whiteRank = primaryRankText(props.white?.rank, ratingMode);
  const showRatingRange =
    settings.rating_range_mode != null && props.stage === GameStage.Unstarted;
  const ratingRangeText =
    settings.rating_difference_lower_unlimited &&
    settings.rating_difference_higher_unlimited
      ? "Unlimited"
      : settings.max_rating_difference_lower ===
          settings.max_rating_difference_higher
        ? String(settings.max_rating_difference_lower)
        : `${settings.max_rating_difference_lower ?? "Unlimited"} / ${settings.max_rating_difference_higher ?? "Unlimited"}`;

  // Compact bar parts
  const parts = [size];

  if (settings.ranked) {
    parts.push("Ranked");
  }

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
  const bLabel = blackRank ? `${bName} ${blackRank}` : bName;
  const wLabel = whiteRank ? `${wName} ${whiteRank}` : wName;

  const isDone =
    props.stage === GameStage.Completed || props.stage === GameStage.Aborted;

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  return (
    <div class="game-info">
      <button
        ref={buttonRef}
        class="game-info-bar"
        onClick={() => setOpen((value) => !value)}
      >
        <IconInfo />
        <span>{parts.join(" · ")}</span>
      </button>
      {open && (
        <div class="game-info-popover popover-surface" ref={popoverRef}>
          <div class="game-info-popover-header">
            <IconInfo />
          </div>
          <dl class="game-info-details">
            {statusText && <Row label="Status" value={statusText} />}
            <Row label="Board" value={size} />
            <Row label="Rated" value={settings.ranked ? "Yes" : "No"} />
            {showRatingRange ? (
              <Row label="Max rating difference" value={ratingRangeText} />
            ) : (
              <>
                <Row label="Komi" value={String(komi)} />
                {settings.handicap >= 2 && (
                  <Row label="Handicap" value={String(settings.handicap)} />
                )}
                {settings.color_reason && (
                  <Row
                    label="Auto settings"
                    value={
                      settings.color_reason === "lower_rating_black"
                        ? "Lower rating plays Black"
                        : settings.color_reason === "exact_rating_random"
                          ? "Equal rating random color"
                          : settings.color_reason
                    }
                  />
                )}
              </>
            )}
            {tcDetail && <Row label="Time" value={tcDetail} />}
            <Row
              label="Black"
              value={`${bLabel} ${blackSymbol()} ${props.capturesBlack} caps`}
            />
            <Row
              label="White"
              value={`${wLabel} ${whiteSymbol()} ${props.capturesWhite} caps`}
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
          <div class="game-info-actions">
            <button
              class="game-info-copy"
              title="Copy access link"
              onClick={() => {
                props.copyInviteLink();
                setCopied(true);
                if (copyTimerRef.current != null) {
                  window.clearTimeout(copyTimerRef.current);
                }
                copyTimerRef.current = window.setTimeout(() => {
                  setCopied(false);
                }, 1500);
              }}
            >
              {copied ? "Copied!" : "Invite"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
