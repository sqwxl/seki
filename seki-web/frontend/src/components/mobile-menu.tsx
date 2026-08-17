import { useEffect, useRef, useState } from "preact/hooks";
import { analysisCapabilities } from "../game/capabilities";
import { liveGameControlsState } from "../game/capabilities/controls";
import { liveSgfExport } from "../game/state";
import type { UserData } from "../game/types";
import {
  analysisSgfExport,
  analysisSgfImport,
  pendingAnalysisSgf,
} from "../layouts/analysis-state";
import { setFlash } from "../utils/flash";
import { ratingDisplayPreference } from "../utils/preferences";
import { parseSgfFile } from "../utils/sgf-import";
import { authUrl, requestSpaNavigation } from "../utils/spa-navigation";
import {
  IconAnalysis,
  IconBot,
  IconFileExport,
  IconFileUpload,
  IconLogin,
  IconLogout,
  IconMenu,
  IconPlus,
  IconPublic,
  IconRegister,
  IconSettings,
  IconUser,
} from "./icons";
import { SettingsDropdownContent } from "./settings-menu";
import { UserLabel } from "./user-label";

export function MobileMenu({
  user,
  onLogout,
}: {
  user?: UserData;
  onLogout?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const username = user?.display_name ?? "Guest";
  const isRegistered = user?.is_registered ?? false;
  const showNavigation = !user?.is_bot;

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

  async function handleLogout() {
    setOpen(false);
    await onLogout?.();
  }

  // Import from the drawer: parse and validate the file here, flash on the
  // current page if it fails; only on success hand it to the analysis page
  // (if open) or navigate there with the parsed content.
  async function handleSgfFileSelected(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";

    if (!file) {
      return;
    }

    setOpen(false);

    const result = await parseSgfFile(file);

    if (!result.ok) {
      setFlash(result.error);

      return;
    }

    if (analysisSgfImport.value) {
      analysisSgfImport.value(result.value);
    } else {
      pendingAnalysisSgf.value = result.value;
      requestSpaNavigation("/analysis");
    }
  }

  return (
    <div class="nav-dropdown-wrapper mobile-menu-wrapper" ref={ref}>
      <button
        type="button"
        class="nav-icon"
        onClick={() => setOpen(!open)}
        title="Menu"
        aria-expanded={open}
      >
        {user ? (
          <>
            <UserLabel
              user={user}
              noLink
              options={{
                rank: { displayMode: ratingDisplayPreference.value },
              }}
            />
            <IconMenu />
          </>
        ) : (
          <>
            <IconUser /> Guest
          </>
        )}
      </button>
      <div
        class={`mobile-drawer-backdrop${open ? " open" : ""}`}
        onClick={() => setOpen(false)}
      />
      <div
        class={`nav-dropdown mobile-menu-dropdown${open ? " open" : ""}`}
        role="dialog"
        aria-label="Menu"
      >
        {showNavigation && (
          <div class="nav-dropdown-section">
            <a
              class="nav-dropdown-item"
              href="/games/new"
              onClick={() => setOpen(false)}
            >
              <IconPlus /> New game
            </a>
            <a
              class="nav-dropdown-item"
              href="/games/spectate"
              onClick={() => setOpen(false)}
            >
              <IconPublic /> Spectate
            </a>
            <a
              class="nav-dropdown-item"
              href="/bot"
              onClick={() => setOpen(false)}
            >
              <IconBot /> Bot Practice
            </a>
            <a
              class="nav-dropdown-item"
              href="/analysis"
              onClick={() => setOpen(false)}
            >
              <IconAnalysis /> Analysis Board
            </a>
            <a
              class="nav-dropdown-item"
              href="/players"
              onClick={() => setOpen(false)}
            >
              <IconUser /> Players
            </a>
          </div>
        )}
        <div class="nav-dropdown-section">
          <button
            type="button"
            class="nav-dropdown-item"
            onClick={() => {
              (
                document.getElementById("sgf-import") as HTMLInputElement
              )?.click();
            }}
          >
            <IconFileUpload /> Import SGF
          </button>
          <input
            type="file"
            id="sgf-import"
            accept=".sgf,.SGF"
            hidden
            onChange={handleSgfFileSelected}
          />
          {liveSgfExport.value && (
            <button
              type="button"
              class="nav-dropdown-item"
              disabled={liveGameControlsState.value.canExitEstimate}
              onClick={() => {
                setOpen(false);
                liveSgfExport.value?.();
              }}
            >
              <IconFileExport /> Download SGF
            </button>
          )}
          {analysisSgfExport.value &&
            analysisCapabilities.value.showSgfExport && (
              <button
                type="button"
                class="nav-dropdown-item"
                onClick={() => {
                  setOpen(false);
                  analysisSgfExport.value?.();
                }}
              >
                <IconFileExport /> Export SGF
              </button>
            )}
        </div>
        <SettingsDropdownContent showLabel={false} />
        <div class="nav-dropdown-section">
          <a
            class="nav-dropdown-item"
            href={`/users/${username}`}
            onClick={() => setOpen(false)}
          >
            <IconSettings /> Profile
          </a>
          {isRegistered ? (
            <button
              type="button"
              class="nav-dropdown-item"
              onClick={handleLogout}
            >
              <IconLogout /> Log out
            </button>
          ) : (
            <>
              <a
                class="nav-dropdown-item"
                href={authUrl("login")}
                onClick={() => setOpen(false)}
              >
                <IconLogin /> Log in
              </a>
              <a
                class="nav-dropdown-item"
                href={authUrl("register")}
                onClick={() => setOpen(false)}
              >
                <IconRegister /> Register
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
