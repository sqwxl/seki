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
	const playerStone = parseInt(root.dataset.playerStone); // 1 for BLACK, -1 for WHITE, 0 for spectator
	const boardCols = parseInt(root.dataset.boardCols);
	const boardRows = parseInt(root.dataset.boardRows);
	
	console.log("Game initialized:", { gameId, playerId, playerName, playerStone, boardCols, boardRows });
	
	// Create empty board for initial render
	const emptyBoard = Array(boardRows).fill().map(() => Array(boardCols).fill(0));
	const emptyKo = { point: [-1, -1], stone: 0 };
	
	// Game state will be received via WebSocket
	let currentStage = null;
	let currentGameState = { board: emptyBoard, ko: emptyKo };
	let currentNegotiations = {};
	let currentTurnStone = null;

	const channel = consumer.subscriptions.create(
		{ channel: "GameChannel", id: gameId },
		{
			received(data) {
				console.log("WebSocket received:", data);
				switch (data.kind) {
					case "state":
						// Update current state variables
						currentStage = data.stage;
						currentGameState = data.state;
						currentNegotiations = data.negotiations || {};
						currentTurnStone = data.current_turn_stone;
						
						console.log("State updated:", { currentStage, currentTurnStone, playerStone, playerName });
						
						// Render the updated state
						renderGoban(currentStage, currentGameState);
						updateUndoControls(currentStage, currentNegotiations, currentTurnStone);
						break;
					case "chat":
						appendToChat(data.sender, data.text);
						break;
					case "error":
						showError(data.message);
						break;
					case "undo_accepted":
					case "undo_rejected":
						// Both use the same handler now with unified messaging
						showUndoResult(data.message);
						if (data.stage && data.state) {
							renderGoban(data.stage, data.state);
							currentTurnStone = data.current_turn_stone;
							updateUndoControls(data.stage, {}, currentTurnStone);
						}
						break;
					case "undo_request_sent":
						// Show waiting state for requesting player
						showUndoWaitingState(data.message);
						break;
					case "undo_response_needed":
						// Show response controls for opponent
						showUndoResponseControls(data.requesting_player, data.message);
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

	function vertexCallback() {
		if (currentStage === "unstarted" || currentStage === "play") {
			return (_, position) => channel.placeStone(position[0], position[1]);
		}

		if (currentStage === "territory") {
			return (_, position) => channel.toggleChain(position[0], position[1]);
		}
	}

	function renderGoban(stage, gameState) {
		if (!gameState || !gameState.board) {
			return;
		}
		
		const { board, ko } = gameState;
		const onVertexClick = vertexCallback();

		const signMap = board;

		const markerMap = Array(board.length).fill(
			Array(board[0].length).fill(null),
		);

		if (ko && ko.stone !== 0) {
			markerMap[ko.point[0]][ko.point[1]] = koMarker;
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

	// Render empty board immediately so user sees the game board
	renderGoban(null, currentGameState);
	
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

	function updateUndoControls(stage, negotiations = {}, turnStone = null) {
		console.log("updateUndoControls called:", { stage, negotiations, turnStone, playerStone, playerName });
		
		const requestBtn = document.getElementById("request-undo-btn");
		const responseControls = document.getElementById("undo-response-controls");
		const notification = document.getElementById("undo-notification");

		if (!requestBtn) {
			console.error("request-undo-btn not found!");
			return;
		}

		// Reset UI state
		requestBtn.disabled = false;
		responseControls.style.display = "none";
		notification.style.display = "none";

		// Only show controls during play stage and if player is actually playing (not spectating)
		if (stage !== "play" || playerStone === 0) {
			console.log("Hiding button: stage =", stage, "playerStone =", playerStone);
			requestBtn.style.display = "none";
			return;
		}

		console.log("Showing button");
		requestBtn.style.display = "inline-block";

		// Basic button state - server will send specific messages for undo requests
		// Disable button if it's the player's turn (they should play, not undo)
		if (turnStone === playerStone) {
			console.log("Disabling button: player's turn");
			requestBtn.disabled = true;
			requestBtn.title = "Cannot undo on your turn";
		} else {
			console.log("Enabling button: can request undo");
			requestBtn.disabled = false;
			requestBtn.title = "Request to undo your last move";
		}
	}


	function showUndoResult(message) {
		const notification = document.getElementById("undo-notification");
		const responseControls = document.getElementById("undo-response-controls");

		responseControls.style.display = "none";
		notification.style.display = "block";
		notification.textContent = message;

		// Hide notification after 5 seconds
		setTimeout(() => {
			notification.style.display = "none";
		}, 5000);
	}

	function showUndoWaitingState(message) {
		const requestBtn = document.getElementById("request-undo-btn");
		const notification = document.getElementById("undo-notification");
		const responseControls = document.getElementById("undo-response-controls");

		// Hide response controls and show waiting state
		responseControls.style.display = "none";
		requestBtn.disabled = true;
		notification.style.display = "block";
		notification.textContent = message;
	}

	function showUndoResponseControls(requestingPlayer, message) {
		const requestBtn = document.getElementById("request-undo-btn");
		const notification = document.getElementById("undo-notification");
		const responseControls = document.getElementById("undo-response-controls");

		// Hide request button and show response controls
		requestBtn.disabled = true;
		responseControls.style.display = "block";
		notification.style.display = "block";
		notification.textContent = message;
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
}
