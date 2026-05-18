import { useEffect, useRef } from "preact/hooks";
import type { UserData } from "../game/types";
import { IconSend } from "./icons";
import { UserLabel } from "./user-label";

export type ChatEntry = {
  id?: number;
  user_data?: UserData | null;
  client_message_id?: string;
  text: string;
  move_number?: number;
  sent_at?: string;
  status?: "pending";
};

export type ChatProps = {
  messages: ChatEntry[];
  onlineUsers: Map<number, UserData>;
  black: UserData | undefined;
  white: UserData | undefined;
  showPrefix: boolean;
  onSend: (text: string) => void;
};

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(iso: string): string {
  return timeFmt.format(new Date(iso));
}

function formatPrefix(entry: ChatEntry): string {
  const parts: string[] = [];

  if (entry.move_number != null) {
    parts.push(`#${entry.move_number}`);
  }

  if (entry.sent_at) {
    parts.push(formatTimestamp(entry.sent_at));
  }

  if (parts.length > 0) {
    return `[${parts.join(" ")}] `;
  }

  return "";
}

function entryUserId(entry: ChatEntry): number | null {
  return entry.user_data?.id ?? null;
}

function SenderLabel(props: {
  entry: ChatEntry;
  black: UserData | undefined;
  white: UserData | undefined;
  presence: boolean;
}) {
  const { entry, black, white, presence } = props;
  const userId = entryUserId(entry);

  if (userId == null) {
    return <>⚑</>;
  }

  if (black?.id === userId) {
    return (
      <UserLabel
        user={black}
        options={{ stone: "black", showPresence: true, presence }}
      />
    );
  }

  if (white?.id === userId) {
    return (
      <UserLabel
        user={white}
        options={{ stone: "white", showPresence: true, presence }}
      />
    );
  }

  if (entry.user_data) {
    return (
      <UserLabel
        user={entry.user_data}
        options={{ showPresence: true, presence }}
      />
    );
  }

  return <span class="user-label">Unknown</span>;
}

export function Chat({
  messages,
  onlineUsers,
  black,
  white,
  onSend,
  showPrefix,
}: ChatProps) {
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
          const userId = entryUserId(entry);
          const presence = userId != null && onlineUsers.has(userId);
          return (
            <p
              key={entry.id ?? entry.client_message_id ?? `${entry.text}-${i}`}
              class={entry.status === "pending" ? "chat-entry-pending" : ""}
            >
              {showPrefix && formatPrefix(entry)}
              <strong>
                <SenderLabel
                  entry={entry}
                  black={black}
                  white={white}
                  presence={presence}
                />
              </strong>
              : {entry.text}
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
          <IconSend />
        </button>
      </form>
    </>
  );
}
