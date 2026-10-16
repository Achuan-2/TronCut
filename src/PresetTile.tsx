import type { ReactNode } from "react";
import { Star, UserRound } from "lucide-react";
import type { PresetKind } from "../shared/preset-library";
import type { PresetLibrary } from "./usePresetLibrary";
import "./PresetLibrary.css";

/** Keep the favorite button separate from the draggable, actionable card. */
export default function PresetTile({
  kind,
  id,
  name,
  custom,
  library,
  children,
}: {
  kind: PresetKind;
  id: string;
  name: string;
  custom?: boolean;
  library: PresetLibrary;
  children: ReactNode;
}) {
  const favorite = library.isFavorite(kind, id);
  return (
    <div
      className={`preset-tile ${favorite ? "is-favorite" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        library.showMenu({ kind, id, x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {custom && (
        <span
          className="preset-user-badge"
          title="用户自定义预设"
          role="img"
          aria-label="用户自定义预设"
        >
          <UserRound size={14} />
        </span>
      )}
      <button
        className="preset-favorite"
        type="button"
        aria-label={`${favorite ? "取消收藏" : "收藏"}：${name}`}
        aria-pressed={favorite}
        title={favorite ? "取消收藏" : "收藏"}
        onClick={() => library.toggleFavorite(kind, id)}
      >
        <Star
          size={19}
          fill={favorite ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
