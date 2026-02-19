export type GameDomElements = {
  status: HTMLElement | null;
  title: HTMLElement | null;
  playerTop: HTMLElement | null;
  playerBottom: HTMLElement | null;
  topClock: HTMLElement | null;
  bottomClock: HTMLElement | null;
  goban: HTMLElement;
  passBtn: HTMLButtonElement | null;
  resignBtn: HTMLButtonElement | null;
  requestUndoBtn: HTMLButtonElement | null;
  resetBtn: HTMLButtonElement | null;
  analyzeBtn: HTMLButtonElement | null;
  exitAnalysisBtn: HTMLButtonElement | null;
  acceptTerritoryBtn: HTMLButtonElement | null;
  abortBtn: HTMLButtonElement | null;
};

export function queryGameDom(): GameDomElements {
  const playerTop = document.getElementById("player-top");
  const playerBottom = document.getElementById("player-bottom");
  return {
    status: document.getElementById("status"),
    title: document.getElementById("game-title"),
    playerTop,
    playerBottom,
    topClock: playerTop?.querySelector<HTMLElement>(".player-clock") ?? null,
    bottomClock: playerBottom?.querySelector<HTMLElement>(".player-clock") ?? null,
    goban: document.getElementById("goban")!,
    passBtn: document.getElementById("pass-btn") as HTMLButtonElement | null,
    resignBtn: document.getElementById("resign-btn") as HTMLButtonElement | null,
    requestUndoBtn: document.getElementById("request-undo-btn") as HTMLButtonElement | null,
    resetBtn: document.getElementById("reset-btn") as HTMLButtonElement | null,
    analyzeBtn: document.getElementById("analyze-btn") as HTMLButtonElement | null,
    exitAnalysisBtn: document.getElementById("exit-analysis-btn") as HTMLButtonElement | null,
    acceptTerritoryBtn: document.getElementById("accept-territory-btn") as HTMLButtonElement | null,
    abortBtn: document.getElementById("abort-btn") as HTMLButtonElement | null,
  };
}
