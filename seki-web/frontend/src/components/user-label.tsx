import { StoneBlack, StoneWhite, IconNigiri } from "./icons";

type UserLabelProps = {
  name: string;
  stone?: "black" | "white" | "nigiri";
  profileUrl?: string;
  isOnline?: boolean;
};

function StoneIcon({ stone }: { stone: "black" | "white" | "nigiri" }) {
  if (stone === "nigiri") {
    return <IconNigiri />;
  }
  return stone === "black" ? <StoneBlack /> : <StoneWhite />;
}

export function UserLabel(props: UserLabelProps) {
  const nameContent = props.profileUrl ? (
    <a href={props.profileUrl}>{props.name}</a>
  ) : (
    props.name
  );

  return (
    <span class="user-label">
      {props.stone && (
        <span class="stone-icon">
          <StoneIcon stone={props.stone} />
        </span>
      )}
      <span class="player-name">{nameContent}</span>
      {props.isOnline !== undefined && (
        <span class={`presence-dot${props.isOnline ? " online" : ""}`} />
      )}
    </span>
  );
}
