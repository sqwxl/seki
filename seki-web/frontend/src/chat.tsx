import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { UserData } from "./goban/types";
import { blackSymbol, whiteSymbol } from "./format";

export type ChatEntry = {
  user_id?: number | null;
  text: string;
  move_number?: number;
  sent_at?: string;
};

type ChatProps = {
  messages: ChatEntry[];
  onlineUsers: Set<number>;
  black: UserData | undefined;
  white: UserData | undefined;
  onSend: (text: string) => void;
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

function resolveSender(
  userId: number | null | undefined,
  black: UserData | undefined,
  white: UserData | undefined,
): string {
  if (userId == null) {
    return "⚑";
  }
  const isBlack = black?.id === userId;
  const isWhite = white?.id === userId;
  const name = (isBlack ? black : isWhite ? white : undefined)
    ?.display_name ?? "?";
  const symbol = isBlack ? blackSymbol() : isWhite ? whiteSymbol() : "?";
  return `${name} ${symbol}`;
}

function Chat({ messages, onlineUsers, black, white, onSend }: ChatProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [messages.length]);

  function handleSubmit(e: Event) {
    e.preventDefault();
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const text = input.value.trim();
    if (text) {
      onSend(text);
      input.value = "";
    }
  }

  return (
    <>
      <div class="chat-box" ref={boxRef}>
        {messages.map((entry, i) => {
          const sender = resolveSender(entry.user_id, black, white);
          const prefix = formatPrefix(entry);
          return (
            <p key={i}>
              {entry.user_id != null && (
                <span
                  class={`presence-dot${onlineUsers.has(entry.user_id) ? " online" : ""}`}
                />
              )}
              {entry.user_id != null ? ` ${prefix}${sender}: ${entry.text}` : `${prefix}${sender}: ${entry.text}`}
            </p>
          );
        })}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          ref={inputRef}
          placeholder="Say something..."
          autocomplete="off"
        />
        <button type="submit">Send</button>
      </form>
    </>
  );
}

export function renderChat(el: HTMLElement, props: ChatProps): void {
  render(<Chat {...props} />, el);
}
