import { useEffect, useRef } from "preact/hooks";
import type { UserData } from "./goban/types";
import { IconSend } from "./icons";
import { UserLabel } from "./user-label";

export type ChatEntry = {
  user_id?: number | null;
  display_name?: string | null;
  text: string;
  move_number?: number;
  sent_at?: string;
};

export type ChatProps = {
  messages: ChatEntry[];
  onlineUsers: Set<number>;
  black: UserData | undefined;
  white: UserData | undefined;
  onSend: (text: string) => void;
};

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
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

function SenderLabel(props: {
  entry: ChatEntry;
  black: UserData | undefined;
  white: UserData | undefined;
  isOnline: boolean;
}) {
  const { entry, black, white, isOnline } = props;
  if (entry.user_id == null) {
    return <>⚑</>;
  }
  if (black?.id === entry.user_id) {
    return (
      <UserLabel
        name={black.display_name}
        stone="black"
        profileUrl={`/users/${black.display_name}`}
        isOnline={isOnline}
      />
    );
  }
  if (white?.id === entry.user_id) {
    return (
      <UserLabel
        name={white.display_name}
        stone="white"
        profileUrl={`/users/${white.display_name}`}
        isOnline={isOnline}
      />
    );
  }
  const name = entry.display_name ?? "?";
  return (
    <UserLabel name={name} profileUrl={`/users/${name}`} isOnline={isOnline} />
  );
}

export function Chat({
  messages,
  onlineUsers,
  black,
  white,
  onSend,
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
          const prefix = formatPrefix(entry);
          const isOnline =
            entry.user_id != null && onlineUsers.has(entry.user_id);
          return (
            <p key={i}>
              {prefix}
              <strong>
                <SenderLabel
                  entry={entry}
                  black={black}
                  white={white}
                  isOnline={isOnline}
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
