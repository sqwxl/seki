import { Component } from "preact";
import type { JSX } from "preact";
import type { BoundedGobanProps } from "./types";
import Goban from "./goban";

interface BoundedGobanState {
  vertexSize: number;
  visibility: "hidden" | "visible";
}

export default class BoundedGoban extends Component<
  BoundedGobanProps,
  BoundedGobanState
> {
  private element: HTMLElement | null = null;

  constructor(props: BoundedGobanProps) {
    super(props);
    this.state = {
      vertexSize: 1,
      visibility: "hidden",
    };
  }

  componentDidMount(): void {
    this.componentDidUpdate({} as BoundedGobanProps);
  }

  componentDidUpdate(prevProps: BoundedGobanProps): void {
    const {
      showCoordinates,
      maxWidth,
      maxHeight,
      maxVertexSize,
      rangeX,
      rangeY,
      signMap,
      onResized = () => {},
    } = this.props;

    if (
      this.state.visibility !== "visible" ||
      showCoordinates !== prevProps?.showCoordinates ||
      maxWidth !== prevProps?.maxWidth ||
      maxHeight !== prevProps?.maxHeight ||
      maxVertexSize !== prevProps?.maxVertexSize ||
      JSON.stringify(rangeX) !== JSON.stringify(prevProps?.rangeX) ||
      JSON.stringify(rangeY) !== JSON.stringify(prevProps?.rangeY) ||
      signMap?.length !== prevProps?.signMap?.length ||
      (signMap?.[0] || []).length !== (prevProps?.signMap?.[0] || []).length
    ) {
      if (!this.element) return;

      const { offsetWidth, offsetHeight } = this.element;
      const scale = Math.min(
        maxWidth / offsetWidth,
        maxHeight / offsetHeight,
      );
      const vertexSize = Math.max(
        Math.floor(this.state.vertexSize * scale),
        1,
      );

      if (this.state.vertexSize !== vertexSize) {
        this.setState({ vertexSize }, onResized);
      }

      if (this.state.visibility !== "visible") {
        this.setState({ visibility: "visible" });
      }
    }
  }

  render(): JSX.Element {
    const {
      innerProps = {},
      style = {},
      maxVertexSize = Number.POSITIVE_INFINITY,
    } = this.props;
    const innerRef =
      (innerProps as Record<string, unknown>).ref as
        | ((el: HTMLElement | null) => void)
        | undefined;

    return (
      <Goban
        {...this.props}
        innerProps={{
          ...innerProps,
          ref: (el: HTMLElement | null) => {
            innerRef?.(el);
            this.element = el;
          },
        }}
        style={{
          visibility: this.state.visibility,
          ...(style as Record<string, unknown>),
        } as JSX.CSSProperties}
        vertexSize={Math.min(this.state.vertexSize, maxVertexSize)}
      />
    );
  }
}
