import htm from "htm";
import { h, render } from "preact";

import "./controllers";
import consumer from "./channels/consumer.js";
import { Goban } from "./goban";

const html = htm.bind(h);
const root = document.getElementById("game");

const koMarker = { type: "triangle", label: "ko" };

if (root != null) {
	const gameId = document.getElementById("game").dataset.gameId;

	const initialStage = root.dataset.stage;
	const initialGameState = JSON.parse(root.dataset.gameState);
	console.log(initialGameState);

	const channel = consumer.subscriptions.create(
		{ channel: "GameChannel", id: gameId },
		{
			received(data) {
				if (data.kind === "state") {
					renderGoban(data.stage, data.state);
					renderStatus(data.payload.status);
					renderCaptures(data.payload.captures);
				} else if (data.kind === "chat") {
					appendToChat(data.sender, data.text);
				}
			},

			placeStone(col, row) {
				this.perform("place_stone", { col, row });
			},

			pass() {
				this.perform("pass");
			},

			resign() {
				this.perform("resign");
			},

			toggleChain(col, row) {
				this.perform("toggle_chain", { col, row });
			},

			chat(text) {
				this.perform("chat", { message: text });
			},
		},
	);

	function vertexCallback(stage) {
		if (stage === "unstarted" || stage === "play") {
			return (_, position) => channel.placeStone(position[0], position[1]);
		}

		if (stage === "territory") {
			return (_, position) => channel.toggleChain(position[0], position[1]);
		}
	}

	function renderGoban(stage, { board, ko }) {
		const onVertexClick = vertexCallback(stage);

		const signMap = board;

		const markerMap = Array(board.length).fill(
			Array(board[0].length).fill(null),
		);

		if (ko.stone !== 0) {
			markerMap[ko.point.col][ko.point.row] = koMarker;
		}

		render(
			html`<${Goban} 
			signMap=${signMap} 
			markerMap=${markerMap}
			fuzzyStonePlacement
			animateStonePlacement
			onVertexClick=${onVertexClick}
			/>`,
			document.getElementById("goban"),
		);
	}

	function renderStatus(text) {
		if (!text) return;
		document.getElementById("status").innerText(text);
	}

	renderGoban(initialStage, initialGameState);
	renderChatLog();

	document.getElementById("chat-form").addEventListener("submit", (e) => {
		e.preventDefault();
		const input = document.getElementById("chat-input");
		const text = input.value.trim();
		if (text) {
			channel.chat(text);
			input.value = "";
		}
	});

	function renderChatLog() {
		const box = document.getElementById("chat-box");
		const raw = box.dataset.chatLog;
		if (raw == null) {
			return;
		}

		const messages = JSON.parse(raw);
		for (const msg of messages) {
			appendToChat(msg.sender, msg.text);
		}
	}

	function appendToChat(sender, text) {
		const box = document.getElementById("chat-box");
		const p = document.createElement("p");
		p.textContent = `${sender}: ${text}`;
		box.appendChild(p);
		box.scrollTop = box.scrollHeight;
	}
}
