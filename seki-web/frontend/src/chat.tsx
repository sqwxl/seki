export function appendToChat(sender: string, text: string): void {
  const box = document.getElementById("chat-box");
  if (!box) {
    return;
  }
  const p = document.createElement("p");
  p.textContent = `${sender}: ${text}`;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
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

  const messages: { sender: string; text: string }[] = JSON.parse(rawMessages);
  for (const msg of messages) {
    appendToChat(msg.sender, msg.text);
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
