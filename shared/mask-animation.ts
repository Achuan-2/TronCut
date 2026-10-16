import type { Clip, Transform } from "./model";
import { setTransform, setKeyframeTransform } from "./editor";
import {
  maskFields,
  maskKeys,
  maskValues,
  type MaskGeometry,
} from "./mask-state";
import type { VisualEdit } from "./crop-animation";

/** Mask geometry uses the same animation endpoints as object transforms. */
export function animateMask(
  clip: Clip,
  patch: Partial<MaskGeometry>,
  edit: VisualEdit,
): Clip {
  if (!clip.visualEffects?.mask || clip.kind === "audio") return clip;
  const fields = Object.fromEntries(
    Object.entries(patch)
      .filter(
        ([field, value]) =>
          Object.hasOwn(maskFields, field) && Number.isFinite(value),
      )
      .map(([field, value]) => [
        maskFields[field as keyof MaskGeometry],
        value,
      ]),
  ) as Partial<Transform>;
  if (!Object.keys(fields).length) return clip;
  const checked = maskValues(clip, { ...clip.transform, ...fields });
  const values = Object.fromEntries(
    Object.keys(fields).map((key) => [
      key,
      checked[key as keyof typeof checked],
    ]),
  );
  if (
    !edit.auto &&
    !edit.endpoint &&
    !maskKeys.some(
      (key) =>
        clip.transform[key] !== undefined ||
        clip.keyframes.some((frame) => frame.value[key] !== undefined),
    )
  ) {
    const settings = Object.fromEntries(
      Object.entries(maskFields)
        .filter(([, key]) => fields[key] !== undefined)
        .map(([field, key]) => [field, checked[key]]),
    );
    return {
      ...clip,
      visualEffects: {
        ...clip.visualEffects,
        mask: { ...clip.visualEffects.mask, ...settings },
      },
    };
  }
  // Materialize implicit mask values before editing an endpoint. Otherwise the
  // first start edit would also change endpoints that inherited the old default.
  const normalize = (value: Transform) => ({
    ...value,
    ...maskValues(clip, value),
  });
  const source = {
    ...clip,
    transform: normalize(clip.transform),
    keyframes: clip.keyframes.map((frame) => ({
      ...frame,
      value: normalize(frame.value),
    })),
  };
  return edit.endpoint
    ? setKeyframeTransform(
        source,
        values,
        edit.endpoint.time,
        edit.endpoint.side === "start",
      )
    : setTransform(source, values, edit.time, edit.auto, edit.duration);
}
