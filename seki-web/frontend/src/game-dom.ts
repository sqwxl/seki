export type GameDomElements = {
  goban: HTMLDivElement;
  status: HTMLDivElement | null;
  title: HTMLHeadingElement | null;
  playerTop: HTMLDivElement | null;
  playerBottom: HTMLDivElement | null;
  passBtn: HTMLButtonElement | null;
  resignBtn: HTMLButtonElement | null;
  requestUndoBtn: HTMLButtonElement | null;
  analyzeBtn: HTMLButtonElement | null;
  exitAnalysisBtn: HTMLButtonElement | null;
  confirmMoveBtn: HTMLButtonElement | null;
  acceptTerritoryBtn: HTMLButtonElement | null;
  abortBtn: HTMLButtonElement | null;
  moveTree: HTMLDivElement | null;
};

export function queryGameDom(): GameDomElements {
  return {
    status: document.getElementById("status") as HTMLDivElement | null,
    title: document.getElementById("game-title") as HTMLHeadingElement | null,
    playerTop: document.getElementById("player-top") as HTMLDivElement | null,
    playerBottom: document.getElementById("player-bottom") as HTMLDivElement | null,
    goban: document.getElementById("goban")! as HTMLDivElement,
    passBtn: document.getElementById("pass-btn") as HTMLButtonElement | null,
    resignBtn: document.getElementById(
      "resign-btn",
    ) as HTMLButtonElement | null,
    requestUndoBtn: document.getElementById(
      "request-undo-btn",
    ) as HTMLButtonElement | null,
    analyzeBtn: document.getElementById(
      "analyze-btn",
    ) as HTMLButtonElement | null,
    exitAnalysisBtn: document.getElementById(
      "exit-analysis-btn",
    ) as HTMLButtonElement | null,
    confirmMoveBtn: document.getElementById(
      "confirm-move-btn",
    ) as HTMLButtonElement | null,
    acceptTerritoryBtn: document.getElementById(
      "accept-territory-btn",
    ) as HTMLButtonElement | null,
    abortBtn: document.getElementById("abort-btn") as HTMLButtonElement | null,
    moveTree: document.getElementById("move-tree") as HTMLDivElement | null,
  };
}
