import type { Clip } from "../shared/model";
import { contentOrigin, defaultContentTransform } from "../shared/crop";
import type { VisualKey } from "../shared/visual-state";
import { defaultFrameCorners, frameCorners } from "../shared/media-frame";
import { effectActiveExpression } from "../shared/effect-timing";

export function mediaFrameFilters(
  clip: Clip,
  fit: number,
  cropExpression?: (key: VisualKey) => string,
) {
  const frame = clip.mediaFrame;
  if (!frame || frame.enabled === false || !frame.radius) return [];
  const corners = frame.corners ?? defaultFrameCorners;
  if (!frameCorners.some((corner) => corners[corner])) return [];
  const width = cropExpression
    ? `W*(1-(${cropExpression("cropLeft")})-(${cropExpression("cropRight")}))`
    : "W";
  const height = cropExpression
    ? `H*(1-(${cropExpression("cropTop")})-(${cropExpression("cropBottom")}))`
    : "H";
  const value =
    frame.unit === "percent"
      ? `min(ld(0),ld(1))*${frame.radius / 100}`
      : String(frame.radius / fit);
  const [tl, tr, br, bl] = frameCorners.map((corner) =>
    corners[corner] ? value : "0",
  );
  const radius = `if(lt(X,W/2),if(lt(Y,H/2),${tl},${bl}),if(lt(Y,H/2),${tr},${br}))`;
  const prefix = `st(0,(${width})/2);st(1,(${height})/2);st(2,min(${radius},min(ld(0),ld(1))));`;
  const mask =
    "lte(pow(max(abs(X+0.5-W/2)-ld(0)+ld(2),0),2)+pow(max(abs(Y+0.5-H/2)-ld(1)+ld(2),0),2),ld(2)*ld(2))";
  return [
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${prefix}alpha(X,Y)*if(${effectActiveExpression(frame, clip)},${mask},1)'`,
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
  hinge?: {
    x: string;
    y: string;
    rotationX: string;
    rotationY: string;
    fps: number;
    start: number;
  };
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
  if (angles.hinge) {
    // The old orthographic projection loses the sign of a hinge's angle.
    // Evaluate the camera homography once per corner/frame, not per pixel.
    const hinge = angles.hinge;
    const sign = (value: string) =>
      `if(gt(${value},0),1,if(lt(${value},0),-1,0))`;
    const hx = `(${hinge.rotationX})*PI/180`,
      hy = `(${hinge.rotationY})*PI/180`;
    const sourceWidth = "((2*W-H)/3)",
      sourceHeight = "((2*H-W)/3)";
    const normalX = `(-sin(${y}))`;
    const normalY = `(cos(${y})*sin(${x})-sin(${y})*${shear})`;
    const cameraX = `(${hinge.x})`,
      cameraY = `(${hinge.y})`;
    const camera =
      [
        `st(0,max(abs(${cameraX})/${sourceWidth},abs(${cameraY})/${sourceHeight}))`,
        `st(1,${sign(cameraX)}*(1-cos(${hy}))*${sourceWidth}/2)`,
        `st(2,${sign(cameraY)}*(1-cos(${hx}))*${sourceHeight}/2)`,
        `st(3,(${sign(cameraX)}*sin(${hy})*${sourceWidth}-${sign(cameraY)}*sin(${hx})*${sourceHeight})/2)`,
        "st(4,1-ld(3)*ld(0))",
      ].join(";") + ";";
    const corners = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].flatMap(([sx, sy], index) => {
      const prefix = `${camera}st(5,${sx}*W/2);st(6,${sy}*H/2);st(7,ld(4)-(${normalX}*ld(5)+${normalY}*ld(6))*ld(0));`;
      const px = `${prefix}((${a})*ld(5)+(${c})*ld(6)+ld(1))/ld(7)-ld(1)/ld(4)+W/2`;
      const py = `${prefix}((${b})*ld(5)+(${d})*ld(6)+ld(2))/ld(7)-ld(2)/ld(4)+H/2`;
      // perspective increments its input counter before evaluating the corners.
      const frameTime = `((in-1)/${hinge.fps}+${hinge.start})`;
      return [
        `x${index}='${px.replace(/\bT\b/g, frameTime)}'`,
        `y${index}='${py.replace(/\bT\b/g, frameTime)}'`,
      ];
    });
    return [
      `fps=${hinge.fps}:start_time=${hinge.start}`,
      // Recover pre-pad dimensions from W/H; leave room for the near edge and Z rotation.
      "pad=w='2*iw+ih':h='iw+2*ih':x=(ow-iw)/2:y=(oh-ih)/2:color=black@0:eval=frame",
      `perspective=${corners.join(":")}:sense=destination:eval=frame:interpolation=linear`,
    ];
  }
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
