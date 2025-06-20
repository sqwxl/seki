import "@hotwired/turbo-rails";
import htm from "htm";
import { h, render } from "preact";

import "./controllers";
import consumer from "./channels/consumer.js";
import { Goban } from "./goban";

const html = htm.bind(h);
const root = document.getElementById("game");

if (root != null) {
	const gameId = document.getElementById("game").dataset.gameId;

	const initialBoard = JSON.parse(root.dataset.game).board;

	const channel = consumer.subscriptions.create(
		{ channel: "GameChannel", id: gameId },
		{
			received(data) {
				if (data.kind === "move") {
					console.log(data.payload.board);
					renderApp(data.payload.board);
				} else if (data.kind === "chat") {
					appendToChat(data.sender, data.text);
				}
			},

			placeStone(col, row) {
				console.log("sending", col, row);
				this.perform("place_stone", { col, row });
			},

			sendChat(text) {
				this.perform("speak", { message: text });
			},
		},
	);

	function App({ signMap }) {
		return html`<${Goban} signMap=${signMap} onVertexClick=${(_, position) => {
			channel.placeStone(position[0], position[1]);
		}} />`;
	}

	function renderApp(board = initialBoard) {
		render(html`<${App} signMap=${board} />`, root);
	}

	renderApp();

	document.getElementById("chat-form").addEventListener("submit", (e) => {
		e.preventDefault();
		const input = document.getElementById("chat-input");
		const text = input.value.trim();
		if (text) {
			channel.sendChat(text);
			input.value = "";
		}
	});

	function appendToChat(sender, text) {
		const box = document.getElementById("chat-box");
		const p = document.createElement("p");
		p.textContent = `${sender}: ${text}`;
		box.appendChild(p);
		box.scrollTop = box.scrollHeight;
	}
}
