import { behaviorName, type Behavior } from "../shared/behaviors";
import type { Clip } from "../shared/model";
import type { Editor } from "./useEditor";

export default function TimelineBehaviorEffect({
  clip,
  behavior,
  locked,
  editor,
}: {
  clip: Clip;
  behavior: Behavior;
  locked: boolean;
  editor: Editor;
}) {
  const selected =
    editor.selectedBehavior?.clipId === clip.id &&
    editor.selectedBehavior.behaviorId === behavior.id;
  return (
    <button
      type="button"
      className={`clip-behavior-effect ${selected ? "selected" : ""} ${behavior.enabled ? "" : "disabled"}`}
      aria-label={`行为效果 ${behaviorName(behavior)}`}
      aria-pressed={selected}
      title={`${behaviorName(behavior)}${behavior.enabled ? "" : "（已禁用）"}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        editor.selectBehavior(clip.id, behavior.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        editor.selectBehavior(clip.id, behavior.id);
        editor.showBehaviorMenu({
          x: event.clientX,
          y: event.clientY,
          clipId: clip.id,
          behaviorId: behavior.id,
          locked,
        });
      }}
    >
      <span>{behaviorName(behavior)}</span>
    </button>
  );
}
