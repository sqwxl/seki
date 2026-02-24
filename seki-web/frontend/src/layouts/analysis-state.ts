import { signal } from "@preact/signals";
import type { Board, TerritoryInfo } from "../goban/create-board";
import type { SgfMeta } from "../utils/sgf";

export const analysisBoard = signal<Board | undefined>(undefined);
export const analysisMeta = signal<SgfMeta | undefined>(undefined);
export const analysisSize = signal(19);
export const analysisTerritoryInfo = signal<TerritoryInfo>({
  reviewing: false,
  finalized: false,
  score: undefined,
});
