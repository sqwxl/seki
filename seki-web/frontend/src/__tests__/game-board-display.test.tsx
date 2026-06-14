import type { VNode } from "preact";
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
import { GameBoardDisplay } from "../components/game-board-display";

type TestVNode = VNode<Record<string, unknown>>;

function childrenOf(node: TestVNode): unknown[] {
  const children = node.props.children;
  return Array.isArray(children) ? children : [children];
}

function findByClass(node: unknown, className: string): TestVNode | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  const vnode = node as TestVNode;

  if (vnode.props?.class === className) {
    return vnode;
  }

  for (const child of childrenOf(vnode)) {
    const found = findByClass(child, className);

    if (found) {
      return found;
    }
  }

  return undefined;
}

describe("GameBoardDisplay", () => {
  it("renders the shared board display structure", () => {
    const ref = createRef<HTMLDivElement>();
    const vnode = (
      <GameBoardDisplay
        gobanRef={ref}
        cols={9}
        rows={13}
        status={<span>Status</span>}
        topPanel={<span>Top</span>}
        bottomPanel={<span>Bottom</span>}
        controls={<button>Pass</button>}
      />
    );

    expect(vnode.type).toBe(GameBoardDisplay);

    const rendered = GameBoardDisplay(vnode.props);

    expect(rendered.props.class).toBe("game-board-column");

    const goban = findByClass(rendered, "goban-container");
    const controls = findByClass(rendered, "controls");

    expect(goban?.props.style).toBe("aspect-ratio: 9/13");
    expect(goban?.ref).toBe(ref);
    expect(controls).toBeDefined();
  });

  it("can hide controls while preserving the goban mount", () => {
    const rendered = GameBoardDisplay({
      gobanRef: createRef<HTMLDivElement>(),
      cols: 19,
      rows: 19,
      controls: <button>Pass</button>,
      hideControls: true,
    });

    expect(findByClass(rendered, "goban-container")).toBeDefined();
    expect(findByClass(rendered, "controls")).toBeUndefined();
  });
});
