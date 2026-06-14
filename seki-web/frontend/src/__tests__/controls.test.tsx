import type { VNode } from "preact";
import { describe, expect, it, vi } from "vitest";
import { Controls } from "../layouts/controls";

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

describe("Controls", () => {
  it("renders confirm move without navigation controls", () => {
    const onClick = vi.fn();
    const rendered = Controls({
      confirmMove: { onClick },
    });

    const confirm = findByClass(
      rendered,
      "btn-raised controls-counter controls-confirm",
    );

    expect(confirm?.props.onClick).toBe(onClick);
  });
});
