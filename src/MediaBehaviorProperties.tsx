import {
  behaviorMovementOptions,
  type BehaviorPhase,
  type BehaviorPhaseKey,
} from "../shared/behaviors";
import NumberControl from "./BehaviorNumberControl";

/** Whole-object controls follow the media phase menus; no character ordering. */
export default function MediaBehaviorProperties({
  phase,
  phaseKey,
  change,
}: {
  phase: BehaviorPhase;
  phaseKey: BehaviorPhaseKey;
  change: (patch: Partial<BehaviorPhase>) => void;
}) {
  if (phase.style === "none") return null;
  const during = phaseKey === "during";
  const number = (
    key:
      | "speed"
      | "tension"
      | "shift"
      | "horizontal"
      | "vertical"
      | "frequency"
      | "intensity"
      | "rotation"
      | "loopTime"
      | "delay"
      | "loops",
    label: string,
    name: string,
    min: number,
    max: number,
    unit = "",
    step = 1,
    disabled = false,
  ) => (
    <NumberControl
      key={`${phaseKey}-${phase.style}-${key}`}
      label={label}
      name={name}
      value={phase[key]}
      min={min}
      max={max}
      step={step}
      unit={unit}
      digits={step < 1 ? 2 : 0}
      disabled={disabled}
      change={(value) => change({ [key]: value })}
    />
  );
  return (
    <div className="media-behavior-controls">
      <label className="field">
        移动
        <select
          aria-label="行为移动"
          value={phase.easing}
          onChange={(event) =>
            change({ easing: event.target.value as BehaviorPhase["easing"] })
          }
        >
          {behaviorMovementOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {[
        "bounce-in",
        "drop",
        "drift",
        "hinge",
        "slide",
        "reveal",
        "pop",
      ].includes(phase.style) && (
        <label className="field">
          {during ? "方向" : phaseKey === "outgoing" ? "移向" : "移自"}
          <select
            aria-label="行为方向"
            value={phase.direction}
            onChange={(event) =>
              change({
                direction: event.target.value as BehaviorPhase["direction"],
              })
            }
          >
            {(
              [
                ["left", "左"],
                ["right", "右"],
                ["top", "上"],
                ["bottom", "下"],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!during &&
        (phase.easing === "spring"
          ? number("tension", "张力", "行为张力", 0.1, 20, "", 0.1)
          : number("speed", "速度", "行为速度（%）", 1, 100, "%"))}
      {during && (
        <>
          {phase.style === "cut" ? (
            number("shift", "平移", "行为平移", 0, 100)
          ) : ["sway", "shake"].includes(phase.style) ? (
            <>
              {number("horizontal", "水平", "行为水平（%）", 0, 100, "%")}
              {number("vertical", "垂直", "行为垂直（%）", 0, 100, "%")}
              {number("frequency", "频率", "行为频率", 0.05, 20, "", 0.05)}
            </>
          ) : (
            phase.style !== "pop" &&
            number("intensity", "强度", "行为强度（%）", 0, 100, "%")
          )}
          {["pop", "drift", "shake"].includes(phase.style) &&
            number("rotation", "旋转", "行为旋转（度）", 0, 180, "°")}
          {number(
            "loopTime",
            "循环时间",
            "行为循环时间（秒）",
            0.05,
            60,
            "s",
            0.05,
          )}
          {number("delay", "延迟", "行为循环延迟（秒）", 0, 60, "s", 0.05)}
          {number(
            "loops",
            "循环",
            "行为循环次数",
            1,
            1000,
            "",
            1,
            phase.loopForever,
          )}
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="永远循环"
              checked={phase.loopForever}
              onChange={(event) =>
                change({ loopForever: event.target.checked })
              }
            />
            永远循环
          </label>
        </>
      )}
    </div>
  );
}
