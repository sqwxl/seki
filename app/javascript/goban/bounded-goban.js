import { Component, createElement as h } from "preact";

import Goban from "./goban.js";

export default class BoundedGoban extends Component {
	constructor(props) {
		super(props);

		this.state = {
			vertexSize: 1,
			visibility: "hidden",
		};
	}

	componentDidMount() {
		this.componentDidUpdate();
	}

	componentDidUpdate(prevProps) {
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
			showCoordinates !== prevProps.showCoordinates ||
			maxWidth !== prevProps.maxWidth ||
			maxHeight !== prevProps.maxHeight ||
			maxVertexSize !== prevProps.maxVertexSize ||
			JSON.stringify(rangeX) !== JSON.stringify(prevProps.rangeX) ||
			JSON.stringify(rangeY) !== JSON.stringify(prevProps.rangeY) ||
			signMap.length !== prevProps.signMap.length ||
			(signMap[0] || []).length !== (prevProps.signMap[0] || []).length
		) {
			const { offsetWidth, offsetHeight } = this.element;
			const scale = Math.min(maxWidth / offsetWidth, maxHeight / offsetHeight);
			const vertexSize = Math.max(Math.floor(this.state.vertexSize * scale), 1);

			if (this.state.vertexSize !== vertexSize) {
				this.setState({ vertexSize }, onResized);
			}

			if (this.state.visibility !== "visible") {
				this.setState({ visibility: "visible" });
			}
		}
	}

	render() {
		const {
			innerProps = {},
			style = {},
			maxVertexSize = Number.POSITIVE_INFINITY,
		} = this.props;
		const { ref: innerRef = () => {} } = innerProps;

		return h(Goban, {
			...this.props,

			innerProps: {
				...innerProps,
				ref: (el) => (innerRef(el), (this.element = el)),
			},

			style: {
				visibility: this.state.visibility,
				...style,
			},

			vertexSize: Math.min(this.state.vertexSize, maxVertexSize),
		});
	}
}
