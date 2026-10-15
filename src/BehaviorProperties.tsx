import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import {
  behaviorName,
  behaviorStyles,
  behaviorStyleLabels,
  behaviorSchema,
  createBehavior,
  type Behavior,
  type BehaviorPhase,
  type BehaviorPhaseKey,
  shiftingPhase,
  behaviorMovementOptions,
  changeBehaviorPhase,
} from "../shared/behaviors";
import type { Clip } from "../shared/model";
import type { Editor } from "./useEditor";
import BehaviorTypeMenu from "./BehaviorTypeMenu";
import ShiftingProperties from "./ShiftingProperties";
import NumberControl from "./BehaviorNumberControl";

export default function BehaviorProperties({
  clip,
  editor,
}: {
  clip: Clip;
  editor: Editor;
}) {
  const [phaseKey, setPhaseKey] = useState<BehaviorPhaseKey>("incoming");
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!menuId) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".behavior-actions"))
        setMenuId(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuId]);
  return (
    <section className="behavior-properties" aria-label="行为属性">
      {clip.behaviors?.map((behavior) => {
        const selected = editor.selectedBehavior?.behaviorId === behavior.id;
        const phase = behavior[phaseKey];
        const update = (patch: Partial<Behavior>) => {
          if (behaviorSchema.safeParse({ ...behavior, ...patch }).success)
            editor.updateBehavior(clip.id, behavior.id, patch);
        };
        const change = (patch: Partial<BehaviorPhase>) =>
          update({ [phaseKey]: changeBehaviorPhase(phase, patch) });
        const selectField = <K extends "style" | "easing" | "direction">(
          label: string,
          key: K,
          options: readonly (readonly [BehaviorPhase[K], string])[],
        ) => (
          <label className="field">
            {label}
            <select
              aria-label={`行为${label}`}
              value={phase[key]}
              onChange={(event) =>
                change(
                  key === "style" && event.target.value === "cut"
                    ? shiftingPhase(phaseKey, clip.kind)
                    : { [key]: event.target.value },
                )
              }
            >
              {options.map(([value, text]) => (
                <option key={String(value)} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        );
        return (
          <div
            key={behavior.id}
            className={`behavior-property ${selected ? "selected" : ""}`}
          >
            <div className="speed-heading">
              <button
                className="behavior-name"
                type="button"
                aria-expanded={selected && collapsedId !== behavior.id}
                onClick={() => {
                  setCollapsedId(
                    selected && collapsedId !== behavior.id
                      ? behavior.id
                      : null,
                  );
                  editor.selectBehavior(clip.id, behavior.id);
                }}
              >
                {selected && collapsedId !== behavior.id ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
                {behaviorName(behavior)}
              </button>
              <div className="behavior-actions">
                <button
                  type="button"
                  aria-label="行为更多选项"
                  aria-haspopup="menu"
                  aria-expanded={menuId === behavior.id}
                  onClick={() =>
                    setMenuId(menuId === behavior.id ? null : behavior.id)
                  }
                >
                  <MoreHorizontal size={17} />
                </button>
                {menuId === behavior.id && (
                  <div
                    className="behavior-actions-popup"
                    role="menu"
                    onClick={() => setMenuId(null)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => editor.copyBehavior(clip.id, behavior.id)}
                    >
                      复制效果
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const reset = createBehavior(
                          behavior.preset,
                          behavior.duration,
                          clip.kind,
                        );
                        if (reset)
                          update({
                            incoming: reset.incoming,
                            during: reset.during,
                            outgoing: reset.outgoing,
                            enabled: true,
                          });
                      }}
                    >
                      重置行为
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        editor.removeBehavior(clip.id, behavior.id)
                      }
                    >
                      删除行为
                    </button>
                  </div>
                )}
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-label={`启用${behaviorName(behavior)}`}
                checked={behavior.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
            </div>
            {selected && collapsedId !== behavior.id && (
              <>
                <div
                  className="behavior-phase-tabs"
                  role="tablist"
                  aria-label="行为阶段"
                >
                  {(
                    [
                      ["incoming", "进"],
                      ["during", "期间"],
                      ["outgoing", "出"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={phaseKey === key}
                      aria-controls={`behavior-${behavior.id}-phase`}
                      onClick={() => setPhaseKey(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id={`behavior-${behavior.id}-phase`}
                  aria-label={`行为${phaseKey === "incoming" ? "进" : phaseKey === "during" ? "期间" : "出"}`}
                >
                  {selectField(
                    "样式",
                    "style",
                    behaviorStyles.map(
                      (style) => [style, behaviorStyleLabels[style]] as const,
                    ),
                  )}
                  {phase.style === "cut" ? (
                    <ShiftingProperties
                      phase={phase}
                      phaseKey={phaseKey}
                      text={clip.kind === "text"}
                      change={change}
                    />
                  ) : (
                    phase.style !== "none" && (
                      <>
                        <div className="field">
                          <span>类型</span>
                          <BehaviorTypeMenu
                            value={phase.type}
                            text={clip.kind === "text"}
                            change={(type) => change({ type })}
                          />
                        </div>
                        {selectField("移动", "easing", behaviorMovementOptions)}
                        {["slide", "drift", "pop", "bounce"].includes(
                          phase.style,
                        ) &&
                          selectField(
                            phaseKey === "outgoing" ? "移向" : "移自",
                            "direction",
                            [
                              ["left", "左"],
                              ["right", "右"],
                              ["top", "上"],
                              ["bottom", "下"],
                            ],
                          )}
                        {phaseKey !== "during" &&
                          (phase.easing === "spring" ? (
                            <NumberControl
                              key={`${phaseKey}-tension`}
                              label="张力"
                              name="行为张力"
                              value={phase.tension}
                              min={0.1}
                              max={20}
                              change={(tension) => change({ tension })}
                            />
                          ) : (
                            <label className="field behavior-range">
                              速度
                              <input
                                aria-label="行为速度滑块"
                                type="range"
                                min={1}
                                max={100}
                                value={phase.speed}
                                onChange={(event) =>
                                  change({ speed: Number(event.target.value) })
                                }
                              />
                              <input
                                aria-label="行为速度（%）"
                                type="number"
                                min={1}
                                max={100}
                                value={phase.speed}
                                onChange={(event) =>
                                  change({ speed: Number(event.target.value) })
                                }
                              />
                              <span>%</span>
                            </label>
                          ))}
                        <label className="field behavior-range">
                          偏移
                          <input
                            aria-label="逐字偏移滑块"
                            type="range"
                            min={0}
                            max={0.5}
                            step={0.01}
                            disabled={phase.type === "whole"}
                            value={phase.offset}
                            onChange={(event) =>
                              change({ offset: Number(event.target.value) })
                            }
                          />
                          <input
                            aria-label="逐字偏移（秒）"
                            type="number"
                            min={0}
                            max={2}
                            step={0.01}
                            disabled={phase.type === "whole"}
                            value={phase.offset}
                            onChange={(event) =>
                              change({ offset: Number(event.target.value) })
                            }
                          />
                          <span>s</span>
                        </label>
                        {phaseKey === "during" && (
                          <>
                            {["sway", "shake"].includes(phase.style) ? (
                              <>
                                {(
                                  [
                                    "horizontal",
                                    "vertical",
                                    "frequency",
                                  ] as const
                                ).map((key) => (
                                  <NumberControl
                                    key={key}
                                    label={
                                      key === "horizontal"
                                        ? "水平"
                                        : key === "vertical"
                                          ? "垂直"
                                          : "频率"
                                    }
                                    name={
                                      key === "horizontal"
                                        ? "行为水平位移"
                                        : key === "vertical"
                                          ? "行为垂直位移"
                                          : "行为频率"
                                    }
                                    value={phase[key]}
                                    min={key === "frequency" ? 0.05 : 0}
                                    max={key === "frequency" ? 20 : 100}
                                    change={(value) => change({ [key]: value })}
                                  />
                                ))}
                              </>
                            ) : (
                              phase.style !== "pop" && (
                                <label className="field">
                                  强度
                                  <input
                                    aria-label="行为强度（%）"
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={phase.intensity}
                                    onChange={(event) =>
                                      change({
                                        intensity: Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                              )
                            )}
                            {["pop", "drift", "shake"].includes(
                              phase.style,
                            ) && (
                              <NumberControl
                                key={`${phaseKey}-rotation`}
                                label="旋转"
                                name="行为旋转（度）"
                                value={phase.rotation}
                                min={0}
                                max={180}
                                unit="°"
                                change={(rotation) => change({ rotation })}
                              />
                            )}
                            <label className="field">
                              循环时间
                              <input
                                aria-label="行为循环时间（秒）"
                                type="number"
                                min={0.05}
                                max={60}
                                step={0.05}
                                value={phase.loopTime}
                                onChange={(event) =>
                                  change({
                                    loopTime: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              延迟
                              <input
                                aria-label="行为循环延迟（秒）"
                                type="number"
                                min={0}
                                max={60}
                                step={0.05}
                                value={phase.delay}
                                onChange={(event) =>
                                  change({ delay: Number(event.target.value) })
                                }
                              />
                            </label>
                            <label className="field">
                              循环次数
                              <input
                                aria-label="行为循环次数"
                                type="number"
                                min={1}
                                max={1000}
                                step={1}
                                disabled={phase.loopForever}
                                value={phase.loops}
                                onChange={(event) =>
                                  change({ loops: Number(event.target.value) })
                                }
                              />
                            </label>
                            <label className="check-field">
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
                        )}
                      </>
                    )
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
