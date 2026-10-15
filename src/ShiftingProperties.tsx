import {
  behaviorMovementOptions,
  type BehaviorPhase,
  type BehaviorPhaseKey,
} from "../shared/behaviors";
import BehaviorTypeMenu from "./BehaviorTypeMenu";
import NumberControl from "./BehaviorNumberControl";

/** Shifting has a different parameter surface from directional slide effects. */
export default function ShiftingProperties({
  phase,
  phaseKey,
  text,
  change,
}: {
  phase: BehaviorPhase;
  phaseKey: BehaviorPhaseKey;
  text: boolean;
  change: (patch: Partial<BehaviorPhase>) => void;
}) {
  const offset =
    text && phase.type !== "whole" ? (
      <NumberControl
        key={`${phaseKey}-offset`}
        label="偏移"
        name="逐字偏移（秒）"
        value={phase.offset}
        min={0}
        max={2}
        step={0.001}
        digits={3}
        unit="s"
        change={(offset) => change({ offset })}
      />
    ) : null;
  return (
    <div className="shifting-controls">
      {text && (
        <div className="field">
          <span>类型</span>
          <BehaviorTypeMenu
            value={phase.type}
            text
            change={(type) => change({ type })}
          />
        </div>
      )}
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
      {phaseKey === "during" ? (
        <>
          <NumberControl
            key="shift"
            label="平移"
            name="行为平移"
            value={phase.shift}
            min={0}
            max={100}
            change={(shift) => change({ shift })}
          />
          <NumberControl
            key="loopTime"
            label="循环时间"
            name="行为循环时间（秒）"
            value={phase.loopTime}
            min={0.05}
            max={60}
            sliderMax={5}
            unit="s"
            change={(loopTime) => change({ loopTime })}
          />
          {offset}
          <NumberControl
            key="delay"
            label="延迟"
            name="行为循环延迟（秒）"
            value={phase.delay}
            min={0}
            max={60}
            unit="s"
            change={(delay) => change({ delay })}
          />
          <NumberControl
            key="loops"
            label="循环"
            name="行为循环次数"
            value={phase.loops}
            min={1}
            max={1000}
            step={1}
            digits={0}
            disabled={phase.loopForever}
            change={(loops) => change({ loops })}
          />
          <label className="check-field shifting-forever">
            <input
              aria-label="永远循环"
              type="checkbox"
              checked={phase.loopForever}
              onChange={(event) =>
                change({ loopForever: event.target.checked })
              }
            />
            永远循环
          </label>
        </>
      ) : (
        <>
          {phase.easing === "spring" ? (
            <NumberControl
              key={`${phaseKey}-tension`}
              label="张力"
              name="行为张力"
              value={phase.tension}
              min={0.1}
              max={20}
              sliderMax={10}
              change={(tension) => change({ tension })}
            />
          ) : (
            <NumberControl
              key={`${phaseKey}-speed`}
              label="速度"
              name="行为速度（%）"
              value={phase.speed}
              min={1}
              max={100}
              step={1}
              digits={0}
              unit="%"
              change={(speed) => change({ speed })}
            />
          )}
          {offset}
        </>
      )}
    </div>
  );
}
