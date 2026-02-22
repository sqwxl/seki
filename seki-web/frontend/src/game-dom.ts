export type GameDomElements = {
  goban: HTMLDivElement;
  status: HTMLDivElement | null;
  title: HTMLHeadingElement | null;
  playerTop: HTMLDivElement | null;
  playerBottom: HTMLDivElement | null;
  controls: HTMLDivElement | null;
};

export function queryGameDom(): GameDomElements {
  return {
    status: document.getElementById("status") as HTMLDivElement | null,
    title: document.getElementById("game-title") as HTMLHeadingElement | null,
    playerTop: document.getElementById("player-top") as HTMLDivElement | null,
    playerBottom: document.getElementById("player-bottom") as HTMLDivElement | null,
    goban: document.getElementById("goban")! as HTMLDivElement,
    controls: document.getElementById("controls") as HTMLDivElement | null,
  };
}
