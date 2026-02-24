export type Sign = 0 | 1 | -1;
export type Point = [number, number];
export type MarkerData = {
  type: string;
  label?: string;
};

export type HeatData = {
  strength: number;
  text?: string | number;
};

export type GhostStoneData = {
  sign: Sign;
  type?: string;
  faint?: boolean;
};

export type LineData = {
  v1: Point;
  v2: Point;
  type?: string;
};

export type VertexEventHandler = (evt: Event, position: Point) => void;
