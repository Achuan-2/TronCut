import type { Clip } from "../shared/model";
import { contentOrigin, defaultContentTransform } from "../shared/crop";

// Resample into a fixed transparent surface. Unlike scaling the whole source,
// this keeps both the clipping boundary and memory use independent of zoom.
function samplePlane(x: string, y: string, visible = "1") {
  const inside = `between(${x},0,W-1)*between(${y},0,H-1)*(${visible})`;
  return `geq=r='r(${x},${y})':g='g(${x},${y})':b='b(${x},${y})':a='if(${inside},alpha(${x},${y}),0)'`;
}

export function contentFilters(clip: Clip) {
  const view = clip.contentTransform ?? defaultContentTransform;
  if (view.x === 0 && view.y === 0 && view.scale === 1) return [];
  const origin = contentOrigin(clip, view);
  return [
    samplePlane(
      `(X+0.5-W*(${origin.x}))/${view.scale}-0.5`,
      `(Y+0.5-H*(${origin.y}))/${view.scale}-0.5`,
    ),
  ];
}

export function axisRotationFilters(angles: {
  x: string;
  y: string;
  z: string;
}) {
  const x = `(${angles.x})*PI/180`,
    y = `(${angles.y})*PI/180`,
    z = `(${angles.z})*PI/180`;
  const a = `cos(${z})*cos(${y})`,
    b = `sin(${z})*cos(${y})`;
  const c = `(cos(${z})*sin(${y})*sin(${x})-sin(${z})*cos(${x}))`;
  const d = `(sin(${z})*sin(${y})*sin(${x})+cos(${z})*cos(${x}))`;
  const determinant = `(cos(${x})*cos(${y}))`;
  const divisor = `if(gt(abs(${determinant}),0.000001),${determinant},1)`;
  return [
    "pad=w='ceil(sqrt(iw*iw+ih*ih)/2)*2':h=ow:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0:eval=frame",
    samplePlane(
      `((${d})*(X-W/2)-(${c})*(Y-H/2))/(${divisor})+W/2`,
      `((${a})*(Y-H/2)-(${b})*(X-W/2))/(${divisor})+H/2`,
      `gt(abs(${determinant}),0.000001)`,
    ),
  ];
}
