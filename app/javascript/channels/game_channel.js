import consumer from "channels/consumer";

const gameId = document.getElementById("game").dataset.gameId;

const channel = consumer.subscriptions.create(
	{ channel: "GameChannel", id: gameId },
	{
		received(data) {
			if (data.kind === "move") {
				placeStone(data.x, data.y, data.color);
			} else if (data.kind === "chat") {
				appendToChat(data.sender, data.text);
			}
		},

		makeMove(x, y) {
			this.perform("make_move", { x, y });
		},

		sendChat(text) {
			this.perform("speak", { message: text });
		},
	},
);

function placeStone(x, y, color) {
	const cell = document.getElementById(`cell-${x}-${y}`);
	if (cell) {
		cell.textContent = color === "black" ? "●" : "○";
	}
}

function appendToChat(sender, text) {
	const box = document.getElementById("chat-box");
	const p = document.createElement("p");
	p.textContent = `${sender}: ${text}`;
	box.appendChild(p);
	box.scrollTop = box.scrollHeight;
}

document.querySelectorAll("#board td").forEach((cell) => {
	cell.addEventListener("click", () => {
		const x = Number.parseInt(cell.dataset.x);
		const y = Number.parseInt(cell.dataset.y);
		channel.makeMove(x, y);
	});
});

document.getElementById("chat-form").addEventListener("submit", (e) => {
	e.preventDefault();
	const input = document.getElementById("chat-input");
	const text = input.value.trim();
	if (text) {
		channel.sendChat(text);
		input.value = "";
	}
});
