import { annotationClip, type AnnotationTemplate } from "../shared/annotations";
import { annotationSvgBody } from "../shared/annotation-style";

export default function AnnotationPresetPreview({
  template,
}: {
  template: AnnotationTemplate;
}) {
  const size = template.kind === "shape" ? template.size : undefined;
  const body =
    template.kind !== "effect"
      ? annotationSvgBody(annotationClip(template, "preview", 0))
      : template.effect === "blur"
        ? '<path d="M300 20 C255 100 195 165 195 215 A105 75 0 0 0 405 215 C405 165 345 100 300 20Z" fill="#c4d8de"/><path d="M330 120 Q410 255 280 260" fill="none" stroke="#ffffff" stroke-width="18"/>'
        : template.effect === "spotlight"
          ? '<rect x="60" y="20" width="480" height="260" fill="#132029"/><path d="M80 250L240 80L400 250Z" fill="#52626a"/><rect x="210" y="70" width="180" height="140" fill="#e1eef4"/><path d="M210 210L300 105L390 210Z" fill="#00b5ef"/>'
          : template.effect === "highlight"
            ? '<path d="M80 100H520M80 150H520M80 200H520" stroke="#d6e1e4" stroke-width="20"/><path d="M110 150H490" stroke="#ffee00" stroke-width="80" opacity="0.6"/>'
            : Array.from(
                { length: 24 },
                (_, i) =>
                  `<rect x="${90 + (i % 6) * 70}" y="${15 + Math.floor(i / 6) * 70}" width="70" height="70" fill="${["#d5e7ef", "#5c8496", "#173e52", "#00b5ef"][(i + Math.floor(i / 6)) % 4]}"/>`,
              ).join("");
  return (
    <svg
      width="100"
      height="54"
      viewBox={`0 0 ${size?.width ?? 600} ${size?.height ?? 300}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
