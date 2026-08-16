import { describe, expect, it } from "vitest";
import { placeTree, type TreeStructure } from "../game/move-tree-layout";

/** Build a TreeStructure from a children adjacency list, filling in parents. */
function tree(children: number[][]): TreeStructure {
  const nodes = children.map((kids) => ({
    parent: null as number | null,
    children: kids,
  }));

  for (let id = 0; id < nodes.length; id++) {
    for (const kid of nodes[id].children) {
      nodes[kid].parent = id;
    }
  }

  return { nodes, root_children: [0] };
}

describe("placeTree", () => {
  it("variant net of length 2", () => {
    // 0 → 1 (mainline), variant off 0: 2 → 3
    const t = tree([[1, 2], [], [3], []]);
    const placement = placeTree(t);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 1, track: 1 });
    expect(placement[3]).toEqual({ id: 3, column: 2, track: 1 });
  });

  it("places first child of main line tip as a variation", () => {
    const t = tree([[1], [2], []]);
    const placement = placeTree(t, 1);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 2, track: 1 });
  });

  it("keeps later live moves on main line after an analysis branch", () => {
    const t = tree([[1], [2], [3, 4], [], []]);
    const placement = placeTree(t, 4);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 2, track: 0 });
    expect(placement[3]).toEqual({ id: 3, column: 3, track: 1 });
    expect(placement[4]).toEqual({ id: 4, column: 3, track: 0 });
  });

  it("bends a net so only the colliding node drops", () => {
    // b-c-d′ off A; d-e off C. d′ collides with d at column 3.
    const t = tree([
      [1, 5], // 0 A
      [2], // 1 B
      [3, 8], // 2 C
      [4], // 3 D
      [], // 4 E
      [6], // 5 b
      [7], // 6 c
      [], // 7 d′
      [9], // 8 d
      [], // 9 e
    ]);
    const placement = placeTree(t);

    expect(placement[5]).toEqual({ id: 5, column: 1, track: 1 }); // b
    expect(placement[6]).toEqual({ id: 6, column: 2, track: 1 }); // c
    expect(placement[7]).toEqual({ id: 7, column: 3, track: 2 }); // d′ dropped
    expect(placement[8]).toEqual({ id: 8, column: 3, track: 1 }); // d
    expect(placement[9]).toEqual({ id: 9, column: 4, track: 1 }); // e
  });

  it("never moves a net back up after it drops", () => {
    // a..f off B; c′-d′ off D. c,d collide and drop; e,f must stay down.
    const t = tree([
      [1], // 0 A
      [2, 6], // 1 B
      [3], // 2 C
      [4, 12], // 3 D
      [5], // 4 E
      [], // 5 F
      [7], // 6 a
      [8], // 7 b
      [9], // 8 c
      [10], // 9 d
      [11], // 10 e
      [], // 11 f
      [13], // 12 c′
      [], // 13 d′
    ]);
    const placement = placeTree(t);

    expect(placement[6]).toEqual({ id: 6, column: 2, track: 1 }); // a
    expect(placement[7]).toEqual({ id: 7, column: 3, track: 1 }); // b
    expect(placement[8]).toEqual({ id: 8, column: 4, track: 2 }); // c dropped
    expect(placement[9]).toEqual({ id: 9, column: 5, track: 2 }); // d
    expect(placement[10]).toEqual({ id: 10, column: 6, track: 2 }); // e stays
    expect(placement[11]).toEqual({ id: 11, column: 7, track: 2 }); // f stays
    expect(placement[12]).toEqual({ id: 12, column: 4, track: 1 }); // c′
    expect(placement[13]).toEqual({ id: 13, column: 5, track: 1 }); // d′
  });

  it("shares a track between non-overlapping nets", () => {
    // a-b off A; d-e off D. No column overlap → both on track 1.
    const t = tree([
      [1, 5], // 0 A
      [2], // 1 B
      [3], // 2 C
      [4, 7], // 3 D
      [], // 4 E
      [6], // 5 a
      [], // 6 b
      [8], // 7 d
      [], // 8 e
    ]);
    const placement = placeTree(t);

    expect(placement[5]).toEqual({ id: 5, column: 1, track: 1 }); // a
    expect(placement[6]).toEqual({ id: 6, column: 2, track: 1 }); // b
    expect(placement[7]).toEqual({ id: 7, column: 4, track: 1 }); // d
    expect(placement[8]).toEqual({ id: 8, column: 5, track: 1 }); // e
  });

  it("keeps a deep sub-net near its parent (tip-to-root sub-net order)", () => {
    // Synthetic root (11) → two alternatives [0, 1]. Branch 1 → 3 → 4 → 5 → 6 → 7 → 8
    // has sub-nets 10 (off 3) and 9 (off 4). 10 must not push 9 to a far track.
    const nodes = [
      { parent: 11, children: [2] }, // 0
      { parent: 11, children: [3] }, // 1
      { parent: 0, children: [] }, // 2
      { parent: 1, children: [4, 10] }, // 3
      { parent: 3, children: [5, 9] }, // 4
      { parent: 4, children: [6] }, // 5
      { parent: 5, children: [7] }, // 6
      { parent: 6, children: [8] }, // 7
      { parent: 7, children: [] }, // 8
      { parent: 4, children: [] }, // 9
      { parent: 3, children: [] }, // 10
      { parent: null, children: [0, 1] }, // 11
    ];
    const placement = placeTree({ nodes, root_children: [11] });

    expect(placement[9]).toEqual({ id: 9, column: 4, track: 2 });
    expect(placement[10]).toEqual({ id: 10, column: 3, track: 2 });
  });

  it("orders sibling variations longest first", () => {
    // 1 has variants 3 (short) and 4 (long). 4 must claim track 1, 3 track 2.
    const t = tree([
      [1], // 0
      [2, 3, 4], // 1
      [], // 2
      [5], // 3 (short)
      [6], // 4 (long)
      [], // 5
      [7], // 6
      [], // 7
    ]);
    const placement = placeTree(t);

    expect(placement[4]).toEqual({ id: 4, column: 2, track: 1 });
    expect(placement[6]).toEqual({ id: 6, column: 3, track: 1 });
    expect(placement[7]).toEqual({ id: 7, column: 4, track: 1 });
    expect(placement[3]).toEqual({ id: 3, column: 2, track: 2 });
    expect(placement[5]).toEqual({ id: 5, column: 3, track: 2 });
  });

  it("uses the longest chain as a net's spine", () => {
    // Net 3 has children 4 (short, children[0]) and 6 (long, children[1]).
    // The spine must follow 6, not children[0].
    const t = tree([
      [1], // 0
      [2, 3], // 1
      [], // 2
      [4, 6], // 3: 4 short, 6 long
      [5], // 4
      [], // 5
      [7], // 6
      [8], // 7
      [], // 8
    ]);
    const placement = placeTree(t);

    expect(placement[3]).toEqual({ id: 3, column: 2, track: 1 });
    expect(placement[6]).toEqual({ id: 6, column: 3, track: 1 });
    expect(placement[7]).toEqual({ id: 7, column: 4, track: 1 });
    expect(placement[8]).toEqual({ id: 8, column: 5, track: 1 });
    expect(placement[4]).toEqual({ id: 4, column: 3, track: 2 });
    expect(placement[5]).toEqual({ id: 5, column: 4, track: 2 });
  });
});
