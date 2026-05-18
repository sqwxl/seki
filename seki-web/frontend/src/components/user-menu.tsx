import { useEffect, useRef, useState } from "preact/hooks";
import {
  board,
  moveConfirmEnabled,
  showCoordinates,
  showMoveTree,
  soundEnabled,
} from "../game/state";
import { readUserData } from "../game/util";
import { analysisBoard } from "../layouts/analysis-state";
import { toggleShowCoordinates } from "../utils/coord-toggle";
import { ratingDisplayPreference, savePref } from "../utils/preferences";
import type { RatingDisplayMode } from "../utils/rating";
import {
  MOVE_CONFIRMATION,
  SHOW_MOVE_TREE,
  SOUND_ENABLED,
  storage,
} from "../utils/storage";
import {
  cycleTheme,
  getThemeIcon,
  getThemeLabel,
  themeMode,
} from "../utils/theme";
import { IconLogin, IconLogout, IconRegister, IconUser } from "./icons";
import { ToggleButton } from "./toggle-button";
import { UserLabel } from "./user-label";

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

function handleMoveTreeToggle() {
  const next = !showMoveTree.value;
  showMoveTree.value = next;
  storage.set(SHOW_MOVE_TREE, String(next));
  savePref("show_move_tree", next);
  board.value?.render();
  analysisBoard.value?.render();
}

function handleSoundToggle() {
  const next = !soundEnabled.value;
  soundEnabled.value = next;
  storage.set(SOUND_ENABLED, String(next));
}

function nextRatingDisplay(mode: RatingDisplayMode): RatingDisplayMode {
  return mode === "kyu_dan" ? "rating" : "kyu_dan";
}

export function UserMenu({
  onLogout,
}: {
  onLogout?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const userData = readUserData();
  const username = userData?.display_name ?? "Guest";
  const isRegistered = userData?.is_registered ?? false;
  const ratingDisplay = ratingDisplayPreference.value;

  function handleRatingDisplayToggle() {
    const next = nextRatingDisplay(ratingDisplayPreference.value);
    savePref("rating_display", next);
  }

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
        class="user-menu-trigger"
        onClick={() => setOpen(!open)}
      >
        {userData ? (
          <UserLabel
            user={userData}
            noLink
            options={{ rank: { displayMode: ratingDisplay } }}
          />
        ) : (
          "Guest"
        )}
      </button>
      {open && (
        <div class="nav-dropdown">
          <div class="nav-dropdown-section">
            <a
              class="nav-dropdown-item"
              href={`/users/${username}`}
              onClick={() => setOpen(false)}
            >
              <IconUser /> Profile
            </a>
          </div>
          <div class="nav-dropdown-section">
            <div class="nav-dropdown-section-label">Settings</div>
            <ThemeButton />
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
              on={showMoveTree.value}
              label="Move tree"
              onToggle={handleMoveTreeToggle}
            />
            <ToggleButton
              on={soundEnabled.value}
              label="Sound"
              onToggle={handleSoundToggle}
            />
            <button
              type="button"
              class="nav-dropdown-item"
              onClick={handleRatingDisplayToggle}
            >
              Rating: {ratingDisplay === "kyu_dan" ? "Kyu/dan" : "Numeric"}
            </button>
          </div>
          <div class="nav-dropdown-section">
            {isRegistered ? (
              <button
                type="button"
                class="nav-dropdown-item"
                onClick={() => onLogout?.()}
              >
                <IconLogout /> Log out
              </button>
            ) : (
              <>
                <a
                  class="nav-dropdown-item"
                  href="/login"
                  onClick={() => setOpen(false)}
                >
                  <IconLogin /> Log in
                </a>
                <a
                  class="nav-dropdown-item"
                  href="/register"
                  onClick={() => setOpen(false)}
                >
                  <IconRegister /> Register
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
