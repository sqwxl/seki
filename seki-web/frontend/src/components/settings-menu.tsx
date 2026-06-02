import { useEffect, useRef, useState } from "preact/hooks";
import {
  board,
  moveConfirmEnabled,
  showCoordinates,
  soundEnabled,
} from "../game/state";
import { readUserData } from "../game/util";
import { analysisBoard } from "../layouts/analysis-state";
import { toggleShowCoordinates } from "../utils/coord-toggle";
import { ratingDisplayPreference, savePref } from "../utils/preferences";
import type { RatingDisplayMode } from "../utils/rating";
import { MOVE_CONFIRMATION, SOUND_ENABLED, storage } from "../utils/storage";
import {
  cycleTheme,
  getThemeIcon,
  getThemeLabel,
  themeMode,
} from "../utils/theme";
import { IconBalance, IconSettings } from "./icons";
import { ToggleButton } from "./toggle-button";

function ThemeButton() {
  const mode = themeMode.value;

  // NOTE: dangerouslySetInnerHTML is safe here — SVG content is hardcoded constants, not user input
  return (
    <button type="button" class="nav-dropdown-item" onClick={cycleTheme}>
      {/* safe: getThemeIcon returns hardcoded SVG constants, not user input */}
      <span dangerouslySetInnerHTML={{ __html: getThemeIcon(mode) }} />
      Theme: {getThemeLabel(mode)}
    </button>
  );
}

function handleCoordsToggle() {
  showCoordinates.value = toggleShowCoordinates();
  savePref("show_coordinates", showCoordinates.value);
  board.value?.setShowCoordinates(showCoordinates.value);
  analysisBoard.value?.setShowCoordinates(showCoordinates.value);
}

function handleMoveConfirmToggle() {
  const next = !moveConfirmEnabled.value;
  moveConfirmEnabled.value = next;
  storage.set(MOVE_CONFIRMATION, String(next));
  savePref("move_confirmation", next);
}

function handleSoundToggle() {
  const next = !soundEnabled.value;
  soundEnabled.value = next;
  storage.set(SOUND_ENABLED, String(next));
}

function nextRatingDisplay(mode: RatingDisplayMode): RatingDisplayMode {
  return mode === "kyu_dan" ? "rating" : "kyu_dan";
}

export function SettingsDropdownContent({
  showLabel = true,
}: {
  showLabel?: boolean;
}) {
  const userData = readUserData();
  const ratingDisplay = ratingDisplayPreference.value;

  function handleRatingDisplayToggle() {
    const next = nextRatingDisplay(ratingDisplayPreference.value);
    savePref("rating_display", next);
  }

  return (
    <div class="nav-dropdown-section">
      {showLabel && <div class="nav-dropdown-section-label">Settings</div>}
      <ThemeButton />
      {!userData?.is_bot && (
        <>
          <ToggleButton
            on={moveConfirmEnabled.value}
            label="Move confirmation"
            onToggle={handleMoveConfirmToggle}
          />
          <ToggleButton
            on={showCoordinates.value}
            label="Coordinates"
            onToggle={handleCoordsToggle}
          />
          <ToggleButton
            on={soundEnabled.value}
            label="Sound"
            onToggle={handleSoundToggle}
          />
        </>
      )}
      <button
        type="button"
        class="nav-dropdown-item"
        onClick={handleRatingDisplayToggle}
      >
        <IconBalance /> {ratingDisplay === "kyu_dan" ? "Kyu/Dan" : "Elo"}
      </button>
    </div>
  );
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", onClickOutside, true);

    return () => document.removeEventListener("click", onClickOutside, true);
  }, [open]);

  return (
    <div class="nav-dropdown-wrapper" ref={ref}>
      <button
        type="button"
        class="nav-icon settings-trigger"
        onClick={() => setOpen(!open)}
        title="Settings"
      >
        <IconSettings />
      </button>
      {open && (
        <div class="nav-dropdown">
          <SettingsDropdownContent />
        </div>
      )}
    </div>
  );
}
