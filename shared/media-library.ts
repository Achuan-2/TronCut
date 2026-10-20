import { uid, type Asset, type Clip, type Project } from "./model";
import { deleteClips, editableIds } from "./timeline";

export function assetClips(project: Project, assetId: string) {
  return project.clips.filter((clip) => clip.assetId === assetId);
}

export function requiredMediaDuration(clips: readonly Clip[]) {
  let end = 0;
  for (const clip of clips) {
    if (clip.kind === "image" || clip.loop) continue;
    // Preserve the complete stitch data, including currently trimmed ranges;
    // project validation and later trim extensions still reference those parts.
    const parts = clip.stitch ?? [
      { sourceIn: clip.sourceIn, duration: clip.duration * clip.speed, freeze: undefined },
    ];
    for (const part of parts)
      end = Math.max(end, part.sourceIn + (part.freeze ? 1e-6 : part.duration));
  }
  return end;
}

export function mediaReplacementError(
  project: Project,
  ids: readonly string[],
  asset: Asset,
) {
  const selected = new Set(ids);
  const clips = project.clips.filter((clip) => selected.has(clip.id));
  if (!clips.length) return "请先选择时间线上的媒体片段";
  if (asset.missing) return "请先更新离线素材";
  if (clips.some((clip) => clip.kind !== asset.kind))
    return "请选择与素材类型相同的媒体片段";
  const editable = editableIds(project, ids);
  if (clips.some((clip) => !editable.has(clip.id)))
    return "请先解锁所选片段的轨道";
  if (
    asset.kind !== "image" &&
    asset.duration + 1e-6 < requiredMediaDuration(clips)
  )
    return "新素材短于所选片段使用的源区间";
  return null;
}

export function replaceSelectedMedia(
  project: Project,
  ids: readonly string[],
  asset: Asset,
): Project {
  const error = mediaReplacementError(project, ids, asset);
  if (error) throw new Error(error);
  const selected = new Set(ids);
  return {
    ...project,
    clips: project.clips.map((clip) =>
      selected.has(clip.id)
        ? { ...clip, assetId: asset.id, name: asset.name }
        : clip,
    ),
  };
}

/** Updating the bin is global; replacing a timeline selection is local. */
export function updateLibraryAsset(
  project: Project,
  id: string,
  replacement?: Asset,
): Project {
  const original = project.assets.find((asset) => asset.id === id);
  if (!original) return project;
  const clips = assetClips(project, id);
  if (
    clips.some(
      (clip) =>
        project.tracks.find((track) => track.id === clip.trackId)?.locked,
    )
  )
    throw new Error("素材被锁定轨道使用，请先解锁轨道");
  if (replacement) {
    if (replacement.kind !== original.kind)
      throw new Error("更新素材的类型必须与原素材一致");
    if (replacement.missing) throw new Error("新素材离线");
    if (
      replacement.kind !== "image" &&
      replacement.duration + 1e-6 < requiredMediaDuration(clips)
    )
      throw new Error("新素材短于项目使用的源区间");
  }
  const removed = replacement
    ? project
    : deleteClips(
      project,
      clips.map((clip) => clip.id),
    );
  if (!replacement && assetClips(removed, id).length)
    throw new Error("素材被锁定组合使用，请先解锁轨道");
  return {
    ...removed,
    ...(project.mediaFolders
      ? {
        mediaFolders: project.mediaFolders.map((folder) => ({
          ...folder,
          assetIds: folder.assetIds.flatMap((assetId) =>
            assetId === id
              ? replacement
                ? [replacement.id]
                : []
              : [assetId],
          ),
        })),
      }
      : {}),
    assets: replacement
      ? project.assets.map((asset) => (asset.id === id ? replacement : asset))
      : project.assets.filter((asset) => asset.id !== id),
    clips: replacement
      ? project.clips.map((clip) =>
        clip.assetId === id ? { ...clip, assetId: replacement.id } : clip,
      )
      : removed.clips,
  };
}

/** Pure changes are committed together, so a locked reference cancels the whole batch. */
export function removeLibraryAssets(
  project: Project,
  ids: readonly string[],
): Project {
  return [...new Set(ids)].reduce(
    (next, id) => updateLibraryAsset(next, id),
    project,
  );
}

export function moveProjectMedia(
  project: Project,
  ids: readonly string[],
  folderId: string | null,
): Project {
  const folders = project.mediaFolders ?? [];
  if (folderId && !folders.some((folder) => folder.id === folderId))
    throw new Error("文件夹不存在");
  const known = new Set(project.assets.map((asset) => asset.id));
  const moving = new Set(ids.filter((id) => known.has(id)));
  return {
    ...project,
    mediaFolders: folders.map((folder) => ({
      ...folder,
      assetIds: [
        ...folder.assetIds.filter((id) => !moving.has(id)),
        ...(folder.id === folderId ? moving : []),
      ],
    })),
  };
}

export function editProjectMediaFolder(
  project: Project,
  command: "new-folder" | "rename" | "delete",
  name: string,
  folderId?: string,
): Project {
  const folders = project.mediaFolders ?? [];
  if (
    command !== "new-folder" &&
    !folders.some((folder) => folder.id === folderId)
  )
    throw new Error("文件夹不存在");
  if (command === "delete")
    return {
      ...project,
      mediaFolders: folders.filter((folder) => folder.id !== folderId),
    };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100)
    throw new Error("文件夹名称须为 1 至 100 个字符");
  if (
    folders.some((folder) => folder.id !== folderId && folder.name === trimmed)
  )
    throw new Error("已存在同名文件夹");
  if (command === "new-folder" && folders.length >= 10000)
    throw new Error("文件夹数量已达上限");
  return {
    ...project,
    mediaFolders:
      command === "new-folder"
        ? [...folders, { id: uid(), name: trimmed, assetIds: [] }]
        : folders.map((folder) =>
          folder.id === folderId ? { ...folder, name: trimmed } : folder,
        ),
  };
}
