import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { UserData } from "./goban/types";
import { blackSymbol, whiteSymbol } from "./format";

export type ChatEntry = {
  user_id?: number | null;
  display_name?: string | null;
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
  entry: ChatEntry,
  black: UserData | undefined,
  white: UserData | undefined,
): string {
  if (entry.user_id == null) {
    return "⚑";
  }
  const isBlack = black?.id === entry.user_id;
  const isWhite = white?.id === entry.user_id;
  if (isBlack) {
    return `${black!.display_name} ${blackSymbol()}`;
  }
  if (isWhite) {
    return `${white!.display_name} ${whiteSymbol()}`;
  }
  return entry.display_name ?? "?";
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
          const sender = resolveSender(entry, black, white);
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
        <button type="submit" aria-label="Send">
          <img src="/static/images/send.svg" alt="" width="20" height="20" />
        </button>
      </form>
    </>
  );
}

export function renderChat(el: HTMLElement, props: ChatProps): void {
  render(<Chat {...props} />, el);
}
