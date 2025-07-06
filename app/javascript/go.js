import htm from "htm";
import { h, render } from "preact";

import "./controllers/index.js";
import consumer from "./channels/consumer.js";
import { BoundedGoban as Goban } from "./goban/index.js";

const html = htm.bind(h);
const root = document.getElementById("game");

const koMarker = { type: "triangle", label: "ko" };

if (root != null) {
	const gameId = root.dataset.gameId;
	const playerId = root.dataset.playerId;
	const playerName = root.dataset.playerName;
	const initialStage = root.dataset.stage;
	const initialGameState = JSON.parse(root.dataset.gameState);

	const channel = consumer.subscriptions.create(
		{ channel: "GameChannel", id: gameId },
		{
			received(data) {
				switch (data.kind) {
					case "state":
						renderGoban(data.stage, data.state);
						renderStatus(data.payload.status);
						renderCaptures(data.payload.captures);
						updateUndoControls(data.stage, data.negotiations);
						break;
					case "chat":
						appendToChat(data.sender, data.text);
						break;
					case "error":
						showError(data.message);
						break;
					case "undo_accepted":
						showUndoResult("accepted", data.responding_player);
						renderGoban(data.stage, data.state);
						updateUndoControls(data.stage, {});
						break;
					case "undo_rejected":
						showUndoResult("rejected", data.responding_player);
						break;
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

			requestUndo() {
				this.perform("request_undo");
			},

			respondToUndo(response) {
				this.perform("respond_to_undo", { response });
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
			maxWidth=800
			maxHeight=800
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

	function showError(message) {
		if (!message) return;
		document.getElementById("game-error").innerText = message;
	}

	function updateUndoControls(stage, negotiations = {}) {
		const requestBtn = document.getElementById("request-undo-btn");
		const responseControls = document.getElementById("undo-response-controls");
		const notification = document.getElementById("undo-notification");

		// Reset UI state
		requestBtn.disabled = false;
		responseControls.style.display = "none";
		notification.style.display = "none";

		// Show request undo button only during play stage
		if (stage === "play") {
			requestBtn.style.display = "inline-block";
		} else {
			requestBtn.style.display = "none";
		}

		// Handle pending undo request
		if (negotiations.undo_request) {
			const undoRequest = negotiations.undo_request;
			
			if (undoRequest.requesting_player === playerName) {
				// Show pending state for requesting player
				requestBtn.disabled = true;
				notification.style.display = "block";
				notification.textContent = `Undo request sent. Waiting for opponent response...`;
			} else {
				// Show response controls for the other player
				responseControls.style.display = "block";
				notification.style.display = "block";
				notification.textContent = `${undoRequest.requesting_player} has requested to undo move ${undoRequest.target_move_number}`;
			}
		}
	}


	function showUndoResult(result, respondingPlayer) {
		const notification = document.getElementById("undo-notification");
		const responseControls = document.getElementById("undo-response-controls");

		responseControls.style.display = "none";
		notification.style.display = "block";

		if (result === "accepted") {
			notification.textContent = `${respondingPlayer} accepted the undo request. Move has been undone.`;
		} else {
			notification.textContent = `${respondingPlayer} rejected the undo request.`;
		}

		// Hide notification after 5 seconds
		setTimeout(() => {
			notification.style.display = "none";
		}, 5000);
	}

	// Event listeners for undo controls
	document.getElementById("request-undo-btn").addEventListener("click", () => {
		channel.requestUndo();
		document.getElementById("request-undo-btn").disabled = true;
		document.getElementById("undo-notification").style.display = "block";
		document.getElementById("undo-notification").textContent =
			"Undo request sent. Waiting for opponent response...";
	});

	document.getElementById("accept-undo-btn").addEventListener("click", () => {
		channel.respondToUndo("accept");
	});

	document.getElementById("reject-undo-btn").addEventListener("click", () => {
		channel.respondToUndo("reject");
	});

	// Initialize undo controls
	updateUndoControls(initialStage);
}
