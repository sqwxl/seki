import { useState, useEffect } from "preact/hooks";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function useDarkMode(): boolean {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    darkQuery.addEventListener("change", handler);
    return () => darkQuery.removeEventListener("change", handler);
  }, []);
  return dark;
}

// Raw SVG markup strings (no dark-mode logic)

export const circleFilledSvg = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>';

export const circleNofillSvg = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>';

export const nigiriSvg = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM520-163q119-15 199.5-104.5T800-480q0-123-80.5-212.5T520-797v634Z"/></svg>';

export const capturesFilledSvg = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor"><path d="M567-167q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM167-287q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm160-320q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Z"/></svg>';

export const capturesNofillSvg = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor"><path d="M567-167q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q760-247 760-280t-23.5-56.5Q713-360 680-360t-56.5 23.5Q600-313 600-280t23.5 56.5Q647-200 680-200t56.5-23.5ZM167-287q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q360-367 360-400t-23.5-56.5Q313-480 280-480t-56.5 23.5Q200-433 200-400t23.5 56.5Q247-320 280-320t56.5-23.5ZM327-607q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q520-687 520-720t-23.5-56.5Q473-800 440-800t-56.5 23.5Q360-753 360-720t23.5 56.5Q407-640 440-640t56.5-23.5ZM680-280ZM280-400Zm160-320Z"/></svg>';

// Dark-mode-aware Preact components
// NOTE: dangerouslySetInnerHTML is safe here - SVG content is hardcoded constants, not user input

export function StoneBlack() {
  const dark = useDarkMode();
  return <span class="icon" dangerouslySetInnerHTML={{ __html: dark ? circleNofillSvg : circleFilledSvg }} />;
}

export function StoneWhite() {
  const dark = useDarkMode();
  return <span class="icon" dangerouslySetInnerHTML={{ __html: dark ? circleFilledSvg : circleNofillSvg }} />;
}

// Captures show opponent's color (black captures white stones, white captures black stones)
export function CapturesBlack() {
  const dark = useDarkMode();
  return <span class="icon" dangerouslySetInnerHTML={{ __html: dark ? capturesFilledSvg : capturesNofillSvg }} />;
}

export function CapturesWhite() {
  const dark = useDarkMode();
  return <span class="icon" dangerouslySetInnerHTML={{ __html: dark ? capturesNofillSvg : capturesFilledSvg }} />;
}

// Imperative helpers (for DOM contexts that can't use Preact components)

export function stoneBlackSvg(): string {
  return darkQuery.matches ? circleNofillSvg : circleFilledSvg;
}

export function stoneWhiteSvg(): string {
  return darkQuery.matches ? circleFilledSvg : circleNofillSvg;
}

export function capturesBlackSvg(): string {
  return darkQuery.matches ? capturesFilledSvg : capturesNofillSvg;
}

export function capturesWhiteSvg(): string {
  return darkQuery.matches ? capturesNofillSvg : capturesFilledSvg;
}

// Re-render stone/captures icons when system theme changes
darkQuery.addEventListener("change", () => {
  for (const el of document.querySelectorAll<HTMLElement>(".stone-icon[data-stone]")) {
    const stone = el.dataset.stone;
    el.innerHTML = stone === "black" ? stoneBlackSvg() : stoneWhiteSvg(); // safe: hardcoded SVG constants
  }
  for (const el of document.querySelectorAll<HTMLElement>(".captures-icon[data-stone]")) {
    const stone = el.dataset.stone;
    el.innerHTML = stone === "black" ? capturesBlackSvg() : capturesWhiteSvg(); // safe: hardcoded SVG constants
  }
});

// --- Control icon SVG strings ---
// All use fill="currentColor" to inherit text color, no dark-mode swapping needed

const svgOpen = '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 -960 960 960" width="1em" fill="currentColor">';

export const analysisSvg = `${svgOpen}<path d="M240-120q-17 0-28.5-11.5T200-160q0-17 11.5-28.5T240-200h160v-80q-83 0-141.5-58.5T200-480q0-57 29-105t80-73q-4 22 1.5 43t17.5 40q-23 16-35.5 41T280-480q0 50 35 85t85 35h280q17 0 28.5 11.5T720-320q0 17-11.5 28.5T680-280H520v80h200q17 0 28.5 11.5T760-160q0 17-11.5 28.5T720-120H240Zm308-394h-1q-16 6-30.5-.5T496-537l-6-16q20-16 31-38.5t11-48.5q0-47-33-79.5T418-752l-5-13q-5-16 1.5-30.5T437-816h1q-6-15 1-29.5t24-20.5q15-5 29.5 1.5T512-842q16-6 31 1t21 23l82 225q6 16-.5 30.5T623-542h-1q6 16-1 31t-24 21q-15 5-29.5-1.5T548-514Zm-179-75q-21-21-21-51t21-51q21-21 51-21t51 21q21 21 21 51t-21 51q-21 21-51 21t-51-21Z"/></svg>`;

export const balanceSvg = `${svgOpen}<path d="M120-120q-17 0-28.5-11.5T80-160q0-17 11.5-28.5T120-200h320v-447q-26-9-45-28t-28-45H240l110 258q5 11 6 22.5t-1 23.5q-9 46-49.5 71T220-320q-45 0-85.5-25T85-416q-2-12-1-23.5t6-22.5l110-258h-40q-17 0-28.5-11.5T120-760q0-17 11.5-28.5T160-800h207q12-35 43-57.5t70-22.5q39 0 70 22.5t43 57.5h207q17 0 28.5 11.5T840-760q0 17-11.5 28.5T800-720h-40l110 258q5 11 6 22.5t-1 23.5q-9 46-49.5 71T740-320q-45 0-85.5-25T605-416q-2-12-1-23.5t6-22.5l110-258H593q-9 26-28 45t-45 28v447h320q17 0 28.5 11.5T880-160q0 17-11.5 28.5T840-120H120Zm545-320h150l-75-174-75 174Zm-520 0h150l-75-174-75 174Zm335-280q17 0 28.5-11.5T520-760q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760q0 17 11.5 28.5T480-720Z"/></svg>`;

export const asteriskSvg = `${svgOpen}<path d="M451.5-131.5Q440-143 440-160v-224L282-225q-12 12-28.5 12T225-225q-12-12-12-28.5t12-28.5l159-158H160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520h224L225-678q-12-12-12-28.5t12-28.5q12-12 28.5-12t28.5 12l158 159v-224q0-17 11.5-28.5T480-840q17 0 28.5 11.5T520-800v224l158-159q12-12 28.5-12t28.5 12q12 12 12 28.5T735-678L576-520h224q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H576l159 158q12 12 12 28.5T735-225q-12 12-28.5 12T678-225L520-384v224q0 17-11.5 28.5T480-120q-17 0-28.5-11.5Z"/></svg>`;

export const dieFilledSvg = `${svgOpen}<path d="M342.5-257.5Q360-275 360-300t-17.5-42.5Q325-360 300-360t-42.5 17.5Q240-325 240-300t17.5 42.5Q275-240 300-240t42.5-17.5Zm0-360Q360-635 360-660t-17.5-42.5Q325-720 300-720t-42.5 17.5Q240-685 240-660t17.5 42.5Q275-600 300-600t42.5-17.5Zm180 180Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm180 180Q720-275 720-300t-17.5-42.5Q685-360 660-360t-42.5 17.5Q600-325 600-300t17.5 42.5Q635-240 660-240t42.5-17.5Zm0-360Q720-635 720-660t-17.5-42.5Q685-720 660-720t-42.5 17.5Q600-685 600-660t17.5 42.5Q635-600 660-600t42.5-17.5ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></svg>`;

export const dieNofillSvg = `${svgOpen}<path d="M342.5-257.5Q360-275 360-300t-17.5-42.5Q325-360 300-360t-42.5 17.5Q240-325 240-300t17.5 42.5Q275-240 300-240t42.5-17.5Zm0-360Q360-635 360-660t-17.5-42.5Q325-720 300-720t-42.5 17.5Q240-685 240-660t17.5 42.5Q275-600 300-600t42.5-17.5Zm180 180Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm180 180Q720-275 720-300t-17.5-42.5Q685-360 660-360t-42.5 17.5Q600-325 600-300t17.5 42.5Q635-240 660-240t42.5-17.5Zm0-360Q720-635 720-660t-17.5-42.5Q685-720 660-720t-42.5 17.5Q600-685 600-660t17.5 42.5Q635-600 660-600t42.5-17.5ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg>`;

export const fileExportSvg = `${svgOpen}<path d="m680-272-36-36q-11-11-28-11t-28 11q-11 11-11 28t11 28l104 104q12 12 28 12t28-12l104-104q11-11 11-28t-11-28q-11-11-28-11t-28 11l-36 36v-127q0-17-11.5-28.5T720-439q-17 0-28.5 11.5T680-399v127ZM600-80h240q17 0 28.5 11.5T880-40q0 17-11.5 28.5T840 0H600q-17 0-28.5-11.5T560-40q0-17 11.5-28.5T600-80Zm-360-80q-33 0-56.5-23.5T160-240v-560q0-33 23.5-56.5T240-880h247q16 0 30.5 6t25.5 17l194 194q11 11 17 25.5t6 30.5v48q0 17-11.5 28.5T720-519q-17 0-28.5-11.5T680-559v-41H540q-25 0-42.5-17.5T480-660v-140H240v560h200q17 0 28.5 11.5T480-200q0 17-11.5 28.5T440-160H240Zm0-80v-560 560Z"/></svg>`;

export const fileUploadSvg = `${svgOpen}<path d="M440-367v127q0 17 11.5 28.5T480-200q17 0 28.5-11.5T520-240v-127l36 36q6 6 13.5 9t15 2.5q7.5-.5 14.5-3.5t13-9q11-12 11.5-28T612-388L508-492q-6-6-13-8.5t-15-2.5q-8 0-15 2.5t-13 8.5L348-388q-12 12-11.5 28t12.5 28q12 11 28 11.5t28-11.5l35-35ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h287q16 0 30.5 6t25.5 17l194 194q11 11 17 25.5t6 30.5v447q0 33-23.5 56.5T720-80H240Zm280-560v-160H240v640h480v-440H560q-17 0-28.5-11.5T520-640ZM240-800v200-200 640-640Z"/></svg>`;

export const graphSvg = `${svgOpen}<path d="M280-80q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-334q-35-12-57.5-43T160-760q0-50 35-85t85-35q50 0 85 35t35 85q0 39-22.5 70T320-647v7q0 50 35 85t85 35h80q83 0 141.5 58.5T720-320v7q35 12 57.5 43t22.5 70q0 50-35 85t-85 35q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-7q0-50-35-85t-85-35h-80q-34 0-64.5-10.5T320-480v167q35 12 57.5 43t22.5 70q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T320-200q0-17-11.5-28.5T280-240q-17 0-28.5 11.5T240-200q0 17 11.5 28.5T280-160Zm400 0q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM280-720q17 0 28.5-11.5T320-760q0-17-11.5-28.5T280-800q-17 0-28.5 11.5T240-760q0 17 11.5 28.5T280-720Z"/></svg>`;

export const gridSvg = `${svgOpen}<path d="M200-200h-80q-17 0-28.5-11.5T80-240q0-17 11.5-28.5T120-280h80v-160h-80q-17 0-28.5-11.5T80-480q0-17 11.5-28.5T120-520h80v-160h-80q-17 0-28.5-11.5T80-720q0-17 11.5-28.5T120-760h80v-80q0-17 11.5-28.5T240-880q17 0 28.5 11.5T280-840v80h160v-80q0-17 11.5-28.5T480-880q17 0 28.5 11.5T520-840v80h160v-80q0-17 11.5-28.5T720-880q17 0 28.5 11.5T760-840v80h80q17 0 28.5 11.5T880-720q0 17-11.5 28.5T840-680h-80v160h80q17 0 28.5 11.5T880-480q0 17-11.5 28.5T840-440h-80v160h80q17 0 28.5 11.5T880-240q0 17-11.5 28.5T840-200h-80v80q0 17-11.5 28.5T720-80q-17 0-28.5-11.5T680-120v-80H520v80q0 17-11.5 28.5T480-80q-17 0-28.5-11.5T440-120v-80H280v80q0 17-11.5 28.5T240-80q-17 0-28.5-11.5T200-120v-80Zm80-80h160v-160H280v160Zm240 0h160v-160H520v160ZM280-520h160v-160H280v160Zm240 0h160v-160H520v160Z"/></svg>`;

export const loginSvg = `${svgOpen}<path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></svg>`;

export const logoutSvg = `${svgOpen}<path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></svg>`;

export const loupeSvg = `${svgOpen}<path d="M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></svg>`;

export const offlineSvg = `${svgOpen}<path d="M762-84 414-434q-31 7-59.5 19T301-386q-21 14-46.5 14.5T212-389q-18-18-16.5-43.5T217-473q23-17 48.5-31t52.5-26l-90-90q-26 14-50.5 29.5T130-557q-20 16-45.5 16T42-559q-18-18-17-43t21-41q22-18 45-34.5t49-30.5l-56-56q-11-11-11-28t11-28q11-11 28-11t28 11l679 679q12 12 12 28.5T819-84q-12 11-28.5 11.5T762-84Zm-353-65.5Q380-179 380-220q0-42 29-71t71-29q42 0 71 29t29 71q0 41-29 70.5T480-120q-42 0-71-29.5ZM753-395q-16 16-37.5 15.5T678-396l-10-10-10-10-96-96q-13-13-5-27t28-9q45 11 85.5 31t75.5 47q18 14 20.5 36.5T753-395Zm165-164q-17 18-42 18.5T831-556q-72-59-161.5-91.5T480-680q-21 0-40.5 1.5T400-674q-25 4-45-10.5T331-724q-4-25 11-45t40-24q24-4 48.5-5.5T480-800q125 0 235.5 41.5T914-644q20 17 21 42t-17 43Z"/></svg>`;

export const onlineSvg = `${svgOpen}<path d="M409-149q-29-29-29-71t29-71q29-29 71-29t71 29q29 29 29 71t-29 71q-29 29-71 29t-71-29Zm213.5-387Q690-512 745-470q20 15 20.5 39.5T748-388q-17 17-42 17.5T661-384q-38-26-84-41t-97-15q-51 0-97 15t-84 41q-20 14-45 13t-42-18q-17-18-17-42.5t20-39.5q55-42 122.5-65.5T480-560q75 0 142.5 24Zm93-223Q826-718 914-643q20 17 21 42t-17 43q-17 17-42 17.5T831-556q-72-59-161.5-91.5T480-680q-100 0-189.5 32.5T129-556q-20 16-45 15.5T42-558q-18-18-17-43t21-42q88-75 198.5-116T480-800q125 0 235.5 41Z"/></svg>`;

export const passSvg = `${svgOpen}<path d="M395-235q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Zm293-325q-32-54-86.5-87T480-680q-77 0-138 44t-87 113q-6 17-18.5 30T207-480q-18 0-29-14.5t-6-31.5q28-102 112.5-168T479-760q73 0 135 29.5T720-650v-70q0-17 11.5-28.5T760-760q17 0 28.5 11.5T800-720v200q0 17-11.5 28.5T760-480H560q-17 0-28.5-11.5T520-520q0-17 11.5-28.5T560-560h128Z"/></svg>`;

export const playbackForwardSvg = `${svgOpen}<path d="M100-315v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T428-480q0 10-4.5 18.5T410-447L162-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Zm400 0v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T828-480q0 10-4.5 18.5T810-447L562-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Z"/></svg>`;

export const playbackNextSvg = `${svgOpen}<path d="M660-280v-400q0-17 11.5-28.5T700-720q17 0 28.5 11.5T740-680v400q0 17-11.5 28.5T700-240q-17 0-28.5-11.5T660-280Zm-440-35v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T548-480q0 10-4.5 18.5T530-447L282-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Z"/></svg>`;

export const playbackPrevSvg = `${svgOpen}<path d="M220-280v-400q0-17 11.5-28.5T260-720q17 0 28.5 11.5T300-680v400q0 17-11.5 28.5T260-240q-17 0-28.5-11.5T220-280Zm458-1L430-447q-9-6-13.5-14.5T412-480q0-10 4.5-18.5T430-513l248-166q5-4 11-5t11-1q16 0 28 11t12 29v330q0 18-12 29t-28 11q-5 0-11-1t-11-5Z"/></svg>`;

export const playbackRewindSvg = `${svgOpen}<path d="M798-281 550-447q-9-6-13.5-14.5T532-480q0-10 4.5-18.5T550-513l248-166q5-4 11-5t11-1q16 0 28 11t12 29v330q0 18-12 29t-28 11q-5 0-11-1t-11-5Zm-400 0L150-447q-9-6-13.5-14.5T132-480q0-10 4.5-18.5T150-513l248-166q5-4 11-5t11-1q16 0 28 11t12 29v330q0 18-12 29t-28 11q-5 0-11-1t-11-5Z"/></svg>`;

export const repeatSvg = `${svgOpen}<path d="m274-200 34 34q12 12 11.5 28T308-110q-12 12-28.5 12.5T251-109L148-212q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l103-103q12-12 28.5-11.5T308-370q11 12 11.5 28T308-314l-34 34h406v-120q0-17 11.5-28.5T720-440q17 0 28.5 11.5T760-400v120q0 33-23.5 56.5T680-200H274Zm412-480H280v120q0 17-11.5 28.5T240-520q-17 0-28.5-11.5T200-560v-120q0-33 23.5-56.5T280-760h406l-34-34q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T709-851l103 103q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L709-589q-12 12-28.5 11.5T652-590q-11-12-11.5-28t11.5-28l34-34Z"/></svg>`;

export const sendSvg = `${svgOpen}<path d="M792-443 176-183q-20 8-38-3.5T120-220v-520q0-22 18-33.5t38-3.5l616 260q25 11 25 37t-25 37ZM200-280l474-200-474-200v140l240 60-240 60v140Zm0 0v-400 400Z"/></svg>`;

export const shareSvg = `${svgOpen}<path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM200-440q17 0 28.5-11.5T240-480q0-17-11.5-28.5T200-520q-17 0-28.5 11.5T160-480q0 17 11.5 28.5T200-440Zm508.5-291.5Q720-743 720-760t-11.5-28.5Q697-800 680-800t-28.5 11.5Q640-777 640-760t11.5 28.5Q663-720 680-720t28.5-11.5ZM680-200ZM200-480Zm480-280Z"/></svg>`;

export const stonesBwSvg = `${svgOpen}<path d="M162-162q-82-82-82-198t82-198q82-82 198-82t198 82q82 82 82 198t-82 198q-82 82-198 82t-198-82Zm339.5-56.5Q560-277 560-360t-58.5-141.5Q443-560 360-560t-141.5 58.5Q160-443 160-360t58.5 141.5Q277-160 360-160t141.5-58.5ZM678-332q2-6 2-13v-15q0-133-93.5-226.5T360-680h-15q-7 0-13 2 26-88 98.5-145T600-880q116 0 198 82t82 198q0 97-57 169.5T678-332Z"/></svg>`;

export const switchOffSvg = `${svgOpen}<path d="M280-240q-100 0-170-70T40-480q0-100 70-170t170-70h400q100 0 170 70t70 170q0 100-70 170t-170 70H280Zm0-80h400q66 0 113-47t47-113q0-66-47-113t-113-47H280q-66 0-113 47t-47 113q0 66 47 113t113 47Zm85-75q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm115-85Z"/></svg>`;

export const switchOnSvg = `${svgOpen}<path d="M280-240q-100 0-170-70T40-480q0-100 70-170t170-70h400q100 0 170 70t70 170q0 100-70 170t-170 70H280Zm485-155q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Z"/></svg>`;

export const timerSvg = `${svgOpen}<path d="M400-840q-17 0-28.5-11.5T360-880q0-17 11.5-28.5T400-920h160q17 0 28.5 11.5T600-880q0 17-11.5 28.5T560-840H400Zm108.5 428.5Q520-423 520-440v-160q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600v160q0 17 11.5 28.5T480-400q17 0 28.5-11.5Zm-168 303Q275-137 226-186t-77.5-114.5Q120-366 120-440t28.5-139.5Q177-645 226-694t114.5-77.5Q406-800 480-800q62 0 119 20t107 58l28-28q11-11 28-11t28 11q11 11 11 28t-11 28l-28 28q38 50 58 107t20 119q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80q-74 0-139.5-28.5ZM678-242q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82ZM480-440Z"/></svg>`;

export const touchDoubleSvg = `${svgOpen}<path d="M638-600q-17 0-28-11.5T599-640q0-4 5-20 8-14 12-29t4-31q0-20-5.5-39.5T595-794q-6-7-10-15.5t-4-17.5q0-15 10.5-26t25.5-11q13 0 23.5 6.5T659-841q22 25 31.5 56.5T700-720q0 26-6.5 51.5T673-620q-5 9-14.5 14.5T638-600ZM419-80q-28 0-52.5-12T325-126L124-381q-8-9-7-21.5t9-20.5q20-21 48-25t52 11l74 45v-328q0-17 11.5-28.5T340-760q17 0 29 11.5t12 28.5v200h299q50 0 85 35t35 85v160q0 66-47 113T640-80H419Zm60-520q-17 0-28.5-11.5T439-640q0-2 5-20 8-14 12-28.5t4-31.5q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 17 4 31.5t12 28.5q3 5 4 10t1 10q0 17-11 28.5T202-600q-11 0-20.5-6T167-621q-13-22-20-47t-7-52q0-83 58.5-141.5T340-920q83 0 141.5 58.5T540-720q0 27-7 52t-20 47q-5 9-14 15t-20 6Z"/></svg>`;

export const touchSingleSvg = `${svgOpen}<path d="M419-80q-28 0-52.5-12T325-126L124-381q-8-9-7-21.5t9-20.5q20-21 48-25t52 11l74 45v-328q0-17 11.5-28.5T340-760q17 0 29 11.5t12 28.5v200h299q50 0 85 35t35 85v160q0 66-47 113T640-80H419Zm60-520q-17 0-28.5-11.5T439-640q0-2 5-20 8-14 12-28.5t4-31.5q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 17 4 31.5t12 28.5q3 5 4 10t1 10q0 17-11 28.5T202-600q-11 0-20.5-6T167-621q-13-22-20-47t-7-52q0-83 58.5-141.5T340-920q83 0 141.5 58.5T540-720q0 27-7 52t-20 47q-5 9-14 15t-20 6Z"/></svg>`;

export const trashSvg = `${svgOpen}<path d="M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM428.5-291.5Q440-303 440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280q17 0 28.5-11.5Zm160 0Q600-303 600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280q17 0 28.5-11.5ZM280-720v520-520Z"/></svg>`;

export const undoSvg = `${svgOpen}<path d="M320-200q-17 0-28.5-11.5T280-240q0-17 11.5-28.5T320-280h244q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l76 76q11 11 11 28t-11 28q-11 11-28 11t-28-11L188-572q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l144-144q11-11 28-11t28 11q11 11 11 28t-11 28l-76 76h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H320Z"/></svg>`;

export const whiteFlagSvg = `${svgOpen}<path d="M280-400v240q0 17-11.5 28.5T240-120q-17 0-28.5-11.5T200-160v-600q0-17 11.5-28.5T240-800h287q14 0 25 9t14 23l10 48h184q17 0 28.5 11.5T800-680v320q0 17-11.5 28.5T760-320H553q-14 0-25-9t-14-23l-10-48H280Zm306 0h134v-240H543q-14 0-25-9t-14-23l-10-48H280v240h257q14 0 25 9t14 23l10 48Zm-86-160Z"/></svg>`;

export const bellSvg = `${svgOpen}<path d="M200-200q-17 0-28.5-11.5T160-240q0-17 11.5-28.5T200-280h40v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h40q17 0 28.5 11.5T800-240q0 17-11.5 28.5T760-200H200Zm280-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z"/></svg>`;

export const bellUnreadSvg = `${svgOpen}<path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm0-420ZM160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v13q-11 22-16 45t-4 47q-10-2-19.5-3.5T480-720q-66 0-113 47t-47 113v280h320v-257q18 8 38.5 12.5T720-520v240h80v80H160Z"/><path d="M635-635q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Z" fill="#e00"/></svg>`;

export const bellDisabledSvg = `${svgOpen}<path d="M646-200H200q-17 0-28.5-11.5T160-240q0-17 11.5-28.5T200-280h40v-280q0-33 8.5-65t25.5-61l60 60q-7 16-10.5 32.5T320-560v280h248L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-28 11t-28-11L646-200ZM540-792q80 20 130 84.5T720-560v110q0 20-12.5 30T680-410q-15 0-27.5-10.5T640-451v-109q0-66-47-113t-113-47q-16 0-34 4t-32 10q-17 7-33.5 3T355-722q-8-13-5.5-27.5T365-771q13-7 27-12t28-9v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28Zm-96 388Zm36 324q-30 0-53.5-16.5T403-141q0-8 6.5-13.5T424-160h112q8 0 14.5 5.5T557-141q0 28-23.5 44.5T480-80Zm33-481Z"/></svg>`;

export const checkSvg = `${svgOpen}<path d="m382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z"/></svg>`;

export const xSvg = `${svgOpen}<path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/></svg>`;

// --- Simple icon Preact components (no dark-mode swapping) ---
// NOTE: dangerouslySetInnerHTML is safe - SVG content is hardcoded constants, not user input

function icon(svg: string) {
  return function IconComponent() {
    return <span class="icon" dangerouslySetInnerHTML={{ __html: svg }} />;
  };
}

export const IconAnalysis = icon(analysisSvg);
export const IconAsterisk = icon(asteriskSvg);
export const IconBalance = icon(balanceSvg);
export const IconBellUnread = icon(bellUnreadSvg);
export const IconCheck = icon(checkSvg);
export const IconDieFilled = icon(dieFilledSvg);
export const IconDieNofill = icon(dieNofillSvg);
export const IconFileExport = icon(fileExportSvg);
export const IconFileUpload = icon(fileUploadSvg);
export const IconGraph = icon(graphSvg);
export const IconGrid = icon(gridSvg);
export const IconLogin = icon(loginSvg);
export const IconLogout = icon(logoutSvg);
export const IconLoupe = icon(loupeSvg);
export const IconOffline = icon(offlineSvg);
export const IconOnline = icon(onlineSvg);
export const IconPass = icon(passSvg);
export const IconPlaybackForward = icon(playbackForwardSvg);
export const IconPlaybackNext = icon(playbackNextSvg);
export const IconPlaybackPrev = icon(playbackPrevSvg);
export const IconPlaybackRewind = icon(playbackRewindSvg);
export const IconRepeat = icon(repeatSvg);
export const IconSend = icon(sendSvg);
export const IconShare = icon(shareSvg);
export const IconStonesBw = icon(stonesBwSvg);
export const IconSwitchOff = icon(switchOffSvg);
export const IconSwitchOn = icon(switchOnSvg);
export const IconTimer = icon(timerSvg);
export const IconTouchDouble = icon(touchDoubleSvg);
export const IconTouchSingle = icon(touchSingleSvg);
export const IconTrash = icon(trashSvg);
export const IconUndo = icon(undoSvg);
export const IconWhiteFlag = icon(whiteFlagSvg);
export const IconX = icon(xSvg);

// --- Imperative DOM helpers ---
// Safe: all SVG content is hardcoded constants from this file, not user input

export function setIcon(id: string, svg: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = svg;
  }
}

export function setIconAll(selector: string, svg: string): void {
  for (const el of document.querySelectorAll(selector)) {
    (el as HTMLElement).innerHTML = svg;
  }
}
