export type ChatEntry = {
  player_id?: number;
  sender: string;
  text: string;
  move_number?: number;
  sent_at?: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatPrefix(entry: ChatEntry): string {
  const parts: string[] = [];
  if (entry.move_number != null) {
    parts.push(`#${entry.move_number}`);
  }
  if (entry.sent_at) {
    parts.push(formatTime(entry.sent_at));
  }
  if (parts.length > 0) {
    return `[${parts.join(" ")}] `;
  }
  return "";
}

export function appendToChat(entry: ChatEntry): void {
  const box = document.getElementById("chat-box");
  if (!box) {
    return;
  }
  const p = document.createElement("p");
  const prefix = formatPrefix(entry);
  if (entry.player_id != null) {
    const dot = document.createElement("span");
    dot.className = "presence-dot";
    dot.dataset.userId = String(entry.player_id);
    p.appendChild(dot);
    p.appendChild(
      document.createTextNode(` ${prefix}${entry.sender}: ${entry.text}`),
    );
  } else {
    p.textContent = `${prefix}${entry.sender}: ${entry.text}`;
  }
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

export function updateChatPresence(onlineUsers: Set<number>): void {
  for (const dot of document.querySelectorAll<HTMLElement>(
    ".chat-box .presence-dot[data-user-id]",
  )) {
    const id = Number(dot.dataset.userId);
    dot.classList.toggle("online", onlineUsers.has(id));
  }
}

export function renderChatHistory(): void {
  const box = document.getElementById("chat-box");
  if (!box) {
    return;
  }
  const rawMessages = box.dataset.chatLog;
  if (!rawMessages) {
    return;
  }

  const messages: ChatEntry[] = JSON.parse(rawMessages);
  for (const msg of messages) {
    appendToChat(msg);
  }
}

export function setupChat(sendMessage: (text: string) => void): void {
  document.getElementById("chat-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input") as HTMLInputElement;
    const text = input.value.trim();
    if (text) {
      sendMessage(text);
      input.value = "";
    }
  });
}
