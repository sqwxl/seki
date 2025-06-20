import { createElement as h } from "preact";

import { vertexEquals } from "./helper.js";

export default function Line(props) {
	const { v1, v2, type = "line", vertexSize } = props;
	if (vertexEquals(v1, v2)) return;

	const [pos1, pos2] = [v1, v2].map((v) => v.map((x) => x * vertexSize));
	const [dx, dy] = pos1.map((x, i) => pos2[i] - x);
	const [left, top] = pos1.map((x, i) => (x + pos2[i] + vertexSize) / 2);

	const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
	const length = Math.sqrt(dx * dx + dy * dy);
	const right = left + length;

	return h("path", {
		className: `shudan-${type}`,
		d: `M ${left} ${top} h ${length} ${
			type === "arrow"
				? (
						() => {
							const [x1, y1] = [right - vertexSize / 2, top - vertexSize / 4];
							const [x2, y2] = [right - vertexSize / 2, top + vertexSize / 4];

							return `L ${x1} ${y1} M ${right} ${top} L ${x2} ${y2}`;
						}
					)()
				: ""
		}`,
		transform: `rotate(${angle} ${left} ${top}) translate(${-length / 2} 0)`,
	});
}
