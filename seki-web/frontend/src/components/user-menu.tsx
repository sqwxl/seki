import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { ToggleButton } from "./toggle-button";
import { readUserData } from "../game/util";
import {
  storage,
  SHOW_COORDINATES,
  SHOW_MOVE_TREE,
  MOVE_CONFIRMATION,
} from "../utils/storage";
import {
  showCoordinates,
  showMoveTree,
  moveConfirmEnabled,
  board,
} from "../game/state";
import { analysisBoard } from "../layouts/analysis-state";
import {
  themeMode,
  cycleTheme,
  getThemeLabel,
  getThemeIcon,
} from "../utils/theme";
import { IconLogin, IconLogout, IconRegister, IconUser } from "./icons";
import { toggleShowCoordinates } from "../utils/coord-toggle";
import { savePref } from "../utils/preferences";

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
        {username}
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

export function initUserMenu(): void {
  const root = document.getElementById("user-menu");
  if (!root) {
    return;
  }
  render(<UserMenu />, root);
}
