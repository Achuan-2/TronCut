import type { Clip } from "../shared/model";
import { contentOrigin, defaultContentTransform } from "../shared/crop";
import type { VisualKey } from "../shared/visual-state";
import { mediaFrameRadii } from "../shared/media-frame";

export function mediaFrameFilters(
  clip: Clip,
  fit: number,
  cropExpression?: (key: VisualKey) => string,
) {
  const radii = mediaFrameRadii(clip);
  if (!radii.some(Boolean)) return [];
  const width = cropExpression
    ? `W*(1-(${cropExpression("cropLeft")})-(${cropExpression("cropRight")}))`
    : "W";
  const height = cropExpression
    ? `H*(1-(${cropExpression("cropTop")})-(${cropExpression("cropBottom")}))`
    : "H";
  const [tl, tr, br, bl] = radii.map((radius) => radius / fit);
  const radius = `if(lt(X,W/2),if(lt(Y,H/2),${tl},${bl}),if(lt(Y,H/2),${tr},${br}))`;
  const prefix = `st(0,(${width})/2);st(1,(${height})/2);st(2,min(${radius},min(ld(0),ld(1))));`;
  const mask =
    "lte(pow(max(abs(X+0.5-W/2)-ld(0)+ld(2),0),2)+pow(max(abs(Y+0.5-H/2)-ld(1)+ld(2),0),2),ld(2)*ld(2))";
  return [
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${prefix}alpha(X,Y)*(${mask})'`,
  ];
}

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

// Compose a changing viewport into a fixed transparent plane. Crop dimensions
// then animate without changing FFmpeg's filter surface or exposing the source
// beyond the crop window; clip position stays at the window's center.
export function animatedViewportFilters(
  expression: (key: VisualKey) => string,
) {
  // FFmpeg expression registers avoid re-evaluating long animation curves
  // dozens of times per pixel, especially for the crop validity mask.
  const prefix =
    [
      `st(0,clip((${expression("contentScale")}),0.05,8))`,
      `st(1,(${expression("contentX")}))`,
      `st(2,(${expression("contentY")}))`,
      ...(["cropLeft", "cropTop", "cropRight", "cropBottom"] as const).map(
        (key, i) => `st(${i + 3},clip((${expression(key)}),0,0.95))`,
      ),
      "st(7,max(1,(ld(3)+ld(5))/0.98))",
      "st(8,max(1,(ld(4)+ld(6))/0.98))",
      "st(3,ld(3)/ld(7))",
      "st(5,ld(5)/ld(7))",
      "st(4,ld(4)/ld(8))",
      "st(6,ld(6)/ld(8))",
      "st(7,(X-W/2-W*ld(1))/ld(0)+W*(0.5+(ld(3)-ld(5))/2))",
      "st(8,(Y-H/2-H*ld(2))/ld(0)+H*(0.5+(ld(4)-ld(6))/2))",
    ].join(";") + ";";
  const mask =
    "between(ld(7),0,W-1)*between(ld(8),0,H-1)*lte(abs(X-W/2),W*(1-ld(3)-ld(5))/2)*lte(abs(Y-H/2),H*(1-ld(4)-ld(6))/2)";
  return [
    `geq=r='${prefix}r(ld(7),ld(8))':g='${prefix}g(ld(7),ld(8))':b='${prefix}b(ld(7),ld(8))':a='${prefix}if(${mask},alpha(ld(7),ld(8)),0)'`,
  ];
}

export function axisRotationFilters(angles: {
  x: string;
  y: string;
  z: string;
  skew?: string;
  maxSkew?: number;
}) {
  const x = `(${angles.x})*PI/180`,
    y = `(${angles.y})*PI/180`,
    z = `(${angles.z})*PI/180`;
  const a = `cos(${z})*cos(${y})`,
    b = `sin(${z})*cos(${y})`;
  const shear = `tan((${angles.skew ?? "0"})*PI/180)`;
  const c = `((${a})*${shear}+cos(${z})*sin(${y})*sin(${x})-sin(${z})*cos(${x}))`;
  const d = `((${b})*${shear}+sin(${z})*sin(${y})*sin(${x})+cos(${z})*cos(${x}))`;
  const determinant = `(cos(${x})*cos(${y}))`;
  const divisor = `if(gt(abs(${determinant}),0.000001),${determinant},1)`;
  return [
    `pad=w='ceil(sqrt(pow(iw+ih*${Math.abs(Math.tan(((angles.maxSkew ?? 0) * Math.PI) / 180))},2)+ih*ih)/2)*2':h=ow:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0:eval=frame`,
    samplePlane(
      `((${d})*(X-W/2)-(${c})*(Y-H/2))/(${divisor})+W/2`,
      `((${a})*(Y-H/2)-(${b})*(X-W/2))/(${divisor})+H/2`,
      `gt(abs(${determinant}),0.000001)`,
    ),
  ];
}
