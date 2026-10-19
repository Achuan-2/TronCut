import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Folder,
  FolderPlus,
  Film,
  Image,
  LayoutGrid,
  List,
  Music2,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Asset } from "../shared/model";
import {
  libraryAssetMime,
  libraryAssetDragSchema,
  type LibraryFolder,
} from "../shared/asset-libraries";
import { MediaThumbnail } from "./MediaThumbnail";
import "./MediaLibrary.css";
import { timeLabel } from "./Preview";
import MediaContextMenu, {
  type MediaCommand,
  type MediaMenuPosition,
} from "./MediaContextMenu";

const categories = [
  { kind: "video", label: "视频", icon: Film },
  { kind: "audio", label: "音频", icon: Music2 },
  { kind: "image", label: "图片", icon: Image },
] as const;
type Preferences = { view: "grid" | "list" };
const preferenceKey = "troncut.media-library";
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
    return {
      view: saved?.view === "list" ? "list" : "grid",
    };
  } catch {
    return { view: "grid" };
  }
}

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  libraryId,
}: {
  asset: Asset;
  selected: boolean;
  libraryId?: string;
}) {
  const card = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (asset.missing || visible || !card.current) return;
    // Do not queue thumbnail decoding for media far outside the scrolling bin.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [asset.missing, visible]);
  const Icon = categories.find(
    (category) => category.kind === asset.kind,
  )!.icon;
  const duration = asset.kind === "image" ? "图片" : timeLabel(asset.duration);
  return (
    <button
      ref={card}
      className={`asset-card ${asset.missing ? "missing" : ""} ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      data-asset-id={asset.id}
      draggable={!asset.missing}
      onDragStart={(event) =>
        event.dataTransfer.setData(
          libraryId ? libraryAssetMime : "framecraft-asset",
          libraryId
            ? JSON.stringify({ libraryId, assetId: asset.id })
            : asset.id,
        )
      }
      title={`${asset.name}\n${asset.missing ? "双击重新链接素材" : "双击添加到时间线"}`}
    >
      <div className={`asset-thumbnail ${asset.kind}`}>
        <Icon size={28} />
        {visible && !asset.missing && (
          <MediaThumbnail asset={asset} waveform={asset.kind === "audio"} />
        )}
        <span>{asset.missing ? "素材离线" : duration}</span>
      </div>
      <span className="asset-name">{asset.name}</span>
      <span className="asset-duration">
        {asset.missing ? "离线" : asset.kind === "image" ? "—" : duration}
      </span>
    </button>
  );
});

export interface MediaLibraryProps {
  assets: Asset[];
  query: string;
  onQueryChange: (query: string) => void;
  onActivate: (asset: Asset) => void;
  onImport: () => void;
  onDropFiles?: (files: File[]) => void;
  dropDisabled?: boolean;
  onCommand: (asset: Asset, command: MediaCommand) => void;
  unavailable: (asset: Asset) => Partial<Record<MediaCommand, string>>;
  libraryId?: string;
  onSaveToLibrary?: (asset: Asset) => void;
  folders?: LibraryFolder[];
  destinations?: { id: string; name: string }[];
  onTransfer?: (asset: Asset, targetId: string, move: boolean) => void;
  onLibraryCommand?: (command: MediaCommand, folderId?: string) => void;
  onDropAsset?: (assetId: string, folderId: string | null) => void;
}

export default function MediaLibrary({
  assets,
  query,
  onQueryChange,
  onActivate,
  onImport,
  onDropFiles,
  dropDisabled = false,
  onCommand,
  unavailable,
  libraryId,
  onSaveToLibrary,
  folders = [],
  destinations,
  onTransfer,
  onLibraryCommand,
  onDropAsset,
}: MediaLibraryProps) {
  const [menu, setMenu] = useState<
    (MediaMenuPosition & { folderId?: string }) | null
  >(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [preferences, setPreferences] = useState(readPreferences);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fileDrop, setFileDrop] = useState(false);
  useEffect(() => {
    if (dropDisabled) setFileDrop(false);
  }, [dropDisabled]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const items = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeMenu();
    setSelectedId(null);
  }, [libraryId, closeMenu]);
  useEffect(() => {
    items.current?.scrollTo({ top: 0 });
  }, [query, preferences.view, libraryId]);
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      // Browsing and importing still work if local storage is unavailable.
    }
  }, [preferences]);
  const assetsById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const menuAsset = menu && assetsById.get(menu.assetId);
  const { filtered, folderAssets, children, visibleFolders } = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const membership = new Map(
      folders.flatMap((folder) =>
        folder.assetIds.map((id) => [id, folder.id] as const),
      ),
    );
    const children = new Map<string, LibraryFolder[]>();
    const matched = new Set<string>();
    const visibleFolders = new Set<string>();
    for (const folder of folders) {
      const siblings = children.get(folder.parentId ?? "") ?? [];
      siblings.push(folder);
      children.set(folder.parentId ?? "", siblings);
      let ancestor: LibraryFolder | undefined = folder;
      while (ancestor) {
        if (ancestor.name.toLocaleLowerCase().includes(needle)) {
          matched.add(folder.id);
          break;
        }
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
    }
    const reveal = (id?: string) => {
      while (id && !visibleFolders.has(id)) {
        visibleFolders.add(id);
        id = byId.get(id)?.parentId;
      }
    };
    matched.forEach(reveal);
    const filtered = assets.filter(
      (asset) =>
        asset.name.toLocaleLowerCase().includes(needle) ||
        matched.has(membership.get(asset.id) ?? ""),
    );
    const folderAssets = new Map<string, Asset[]>();
    for (const asset of filtered) {
      const folderId = membership.get(asset.id) ?? "";
      const items = folderAssets.get(folderId) ?? [];
      items.push(asset);
      folderAssets.set(folderId, items);
      reveal(folderId);
    }
    return { filtered, folderAssets, children, visibleFolders };
  }, [assets, folders, query]);
  const renderAssets = (items: Asset[]) => (
    <div className={preferences.view === "grid" ? "asset-grid" : "asset-list"}>
      {items.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedId === asset.id}
          libraryId={libraryId}
        />
      ))}
    </div>
  );
  const dropHandlers = (folderId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(libraryAssetMime)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(folderId ?? "root");
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(libraryAssetMime);
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      try {
        const payload = libraryAssetDragSchema.parse(JSON.parse(raw));
        if (payload.libraryId !== libraryId) return;
        onDropAsset?.(payload.assetId, folderId);
        if (folderId) setExpanded((current) => new Set(current).add(folderId));
      } catch {
        /* Ignore unsupported drag payloads. */
      }
    },
  });
  const renderFolder = (folder: LibraryFolder): React.ReactNode => {
    if (!visibleFolders.has(folder.id)) return null;
    const open = !!query.trim() || expanded.has(folder.id);
    return (
      <section className="library-folder" key={folder.id}>
        <button
          className={`library-folder-heading ${dropTarget === folder.id ? "drop-target" : ""}`}
          data-folder-id={folder.id}
          aria-expanded={open}
          aria-label={`${open ? "折叠" : "展开"}文件夹 ${folder.name}`}
          onClick={() =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(folder.id)) next.delete(folder.id);
              else next.add(folder.id);
              return next;
            })
          }
          {...dropHandlers(folder.id)}
        >
          <ChevronDown size={13} />
          <Folder size={23} />
          <span>{folder.name}</span>
          <small>{folder.assetIds.length}</small>
        </button>
        {open && (
          <div className="library-folder-content">
            {children.get(folder.id)?.map(renderFolder)}
            {renderAssets(folderAssets.get(folder.id) ?? [])}
          </div>
        )}
      </section>
    );
  };
  return (
    <div
      className={`media-browser ${fileDrop ? "media-file-drop" : ""}`}
      onDragOver={(event) => {
        if (!onDropFiles || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = dropDisabled ? "none" : "copy";
        setFileDrop(!dropDisabled);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFileDrop(false);
      }}
      onDrop={(event) => {
        if (!onDropFiles || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setFileDrop(false);
        if (!dropDisabled && event.dataTransfer.files.length)
          onDropFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {fileDrop && (
        <div className="media-file-drop-hint">松开以导入项目媒体</div>
      )}
      <div className="media-browser-toolbar">
        <div className="media-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="搜索素材"
            placeholder="搜索素材…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button aria-label="清除素材搜索" onClick={() => onQueryChange("")}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      {libraryId && (
        <button
          className={`library-root-drop ${dropTarget === "root" ? "drop-target" : ""}`}
          {...dropHandlers(null)}
          title="将素材拖到这里，移出文件夹"
        >
          库根目录
        </button>
      )}
      <div
        ref={items}
        className={`media-browser-items media-view-${preferences.view}`}
        onContextMenu={(event) => {
          event.preventDefault();
          const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".asset-card",
          );
          if (!card) {
            const folder = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-folder-id]",
            );
            if (libraryId)
              setMenu({
                assetId: "",
                folderId: folder?.dataset.folderId,
                x: event.clientX,
                y: event.clientY,
              });
            else closeMenu();
            return;
          }
          const assetId = card.dataset.assetId!;
          setSelectedId(assetId);
          setMenu({ assetId, x: event.clientX, y: event.clientY });
        }}
        onClick={(event) => {
          const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".asset-card",
          );
          if (card) setSelectedId(card.dataset.assetId!);
        }}
        onDoubleClick={(event) => {
          const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".asset-card",
          );
          const asset = card && assetsById.get(card.dataset.assetId!);
          if (asset) onActivate(asset);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".asset-card",
          );
          const asset = card && assetsById.get(card.dataset.assetId!);
          if (asset) {
            event.preventDefault();
            onActivate(asset);
          }
        }}
      >
        {!assets.length && !folders.length ? (
          <div className="library-empty">
            <Film size={36} />
            <b>
              {libraryId ? "添加常用素材，跨工程复用" : "导入视频、音频或图片"}
            </b>
            <p>
              {libraryId
                ? "点击下方“导入到库”，或在项目媒体中右键添加"
                : "拖入素材，或点击下方“导入媒体”"}
              <br />
              双击素材即可加入时间线
            </p>
          </div>
        ) : !filtered.length && !visibleFolders.size ? (
          <div className="media-no-results" role="status">
            没有匹配的素材
          </div>
        ) : (
          <>
            {children.get("")?.map(renderFolder)}
            {renderAssets(folderAssets.get("") ?? [])}
          </>
        )}
      </div>
      <div className="media-browser-footer">
        <button className="media-import-button" onClick={onImport}>
          <Plus size={16} />
          {libraryId ? "导入到库" : "导入媒体"}
        </button>
        {libraryId && (
          <button
            aria-label="新建文件夹"
            title="新建文件夹"
            onClick={() => onLibraryCommand?.("new-folder")}
          >
            <FolderPlus size={16} />
          </button>
        )}
        <div className="media-view-buttons" role="group" aria-label="素材视图">
          {(
            [
              { view: "grid", label: "缩略图视图", icon: LayoutGrid },
              { view: "list", label: "列表视图", icon: List },
            ] as const
          ).map(({ view, label, icon: Icon }) => (
            <button
              key={view}
              aria-label={label}
              title={label}
              aria-pressed={preferences.view === view}
              onClick={() =>
                setPreferences((current) => ({ ...current, view }))
              }
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>
      {menu && (menuAsset || libraryId) && (
        <MediaContextMenu
          menu={menu}
          onClose={closeMenu}
          unavailable={menuAsset ? unavailable(menuAsset) : {}}
          onCommand={(command) =>
            menuAsset
              ? onCommand(menuAsset, command)
              : onLibraryCommand?.(command, menu.folderId)
          }
          onSaveToLibrary={
            onSaveToLibrary && menuAsset
              ? () => onSaveToLibrary(menuAsset)
              : undefined
          }
          destinations={destinations}
          onTransfer={
            menuAsset && onTransfer
              ? (targetId, move) => onTransfer(menuAsset, targetId, move)
              : undefined
          }
          commands={
            libraryId
              ? menuAsset
                ? [
                    ["add", "添加到时间轴播放头所处位置"],
                    ["delete", "删除"],
                    ["rename", "重命名…"],
                    ["export", "导出资产…"],
                  ]
                : menu.folderId
                  ? [
                      ["new-folder", "新建子文件夹…"],
                      ["rename", "重命名文件夹…"],
                      ["delete", "删除文件夹…"],
                    ]
                  : [
                      ["import", "将媒体导入库…"],
                      ["new-folder", "新建文件夹…"],
                      ["export-library", "导出库…"],
                      ["import-library", "导入压缩库…"],
                    ]
              : undefined
          }
        />
      )}
    </div>
  );
}
