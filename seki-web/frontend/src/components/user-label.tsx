import { StoneBlack, StoneWhite } from "./icons";

type UserLabelProps = {
  name: string;
  stone?: "black" | "white";
  profileUrl?: string;
  isOnline?: boolean;
};

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
          {props.stone === "black" ? <StoneBlack /> : <StoneWhite />}
        </span>
      )}
      <span class="player-name">{nameContent}</span>
      {props.isOnline !== undefined && (
        <span class={`presence-dot${props.isOnline ? " online" : ""}`} />
      )}
    </span>
  );
}
