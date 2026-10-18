import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
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
import { libraryAssetMime } from "../shared/asset-libraries";
import { MediaThumbnail } from "./MediaThumbnail";
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
type Category = Asset["kind"] | "all";
type Preferences = { view: "grid" | "list"; grouping: "type" | "none" };
const preferenceKey = "troncut.media-library";
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
    return {
      view: saved?.view === "list" ? "list" : "grid",
      grouping: saved?.grouping === "none" ? "none" : "type",
    };
  } catch {
    return { view: "grid", grouping: "type" };
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
  onCommand: (asset: Asset, command: MediaCommand) => void;
  unavailable: (asset: Asset) => Partial<Record<MediaCommand, string>>;
  libraryId?: string;
  onSaveToLibrary?: (asset: Asset) => void;
}

export default function MediaLibrary({
  assets,
  query,
  onQueryChange,
  onActivate,
  onImport,
  onCommand,
  unavailable,
  libraryId,
  onSaveToLibrary,
}: MediaLibraryProps) {
  const [menu, setMenu] = useState<MediaMenuPosition | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [preferences, setPreferences] = useState(readPreferences);
  const [category, setCategory] = useState<Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const items = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeMenu();
    setSelectedId(null);
  }, [libraryId, closeMenu]);
  useEffect(() => {
    items.current?.scrollTo({ top: 0 });
  }, [query, category, preferences.view, preferences.grouping, libraryId]);
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
  const { filtered, groups, counts } = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const counts = { video: 0, audio: 0, image: 0 };
    for (const asset of assets) counts[asset.kind]++;
    const filtered = assets.filter(
      (asset) =>
        (category === "all" || category === asset.kind) &&
        asset.name.toLocaleLowerCase().includes(needle),
    );
    const groups =
      preferences.grouping === "none"
        ? [{ key: "all", label: "全部媒体", items: filtered }]
        : categories
            .map(({ kind, label }) => ({
              key: kind,
              label,
              items: filtered.filter((asset) => asset.kind === kind),
            }))
            .filter((group) => group.items.length);
    return { filtered, groups, counts };
  }, [assets, query, category, preferences.grouping]);
  return (
    <div className="media-browser">
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
        <div className="media-browser-options">
          <select
            aria-label="素材类别"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            <option value="all">全部媒体 ({assets.length})</option>
            {categories.map(({ kind, label }) => (
              <option key={kind} value={kind}>
                {label} ({counts[kind]})
              </option>
            ))}
          </select>
          <select
            aria-label="素材分组"
            value={preferences.grouping}
            onChange={(event) =>
              setPreferences((current) => ({
                ...current,
                grouping: event.target.value as Preferences["grouping"],
              }))
            }
          >
            <option value="type">按类别分组</option>
            <option value="none">不分组</option>
          </select>
        </div>
      </div>
      <div
        ref={items}
        className={`media-browser-items media-view-${preferences.view}`}
        onContextMenu={(event) => {
          event.preventDefault();
          const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".asset-card",
          );
          if (!card) {
            closeMenu();
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
        {!assets.length ? (
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
        ) : !filtered.length ? (
          <div className="media-no-results" role="status">
            没有匹配的素材
          </div>
        ) : (
          groups.map((group) => (
            <section
              className="asset-group"
              key={group.key}
              aria-label={`${group.label}素材`}
            >
              {preferences.grouping === "type" && (
                <h3 className="asset-group-heading">
                  <button
                    aria-label={`${collapsed.has(group.key) ? "展开" : "折叠"}${group.label}分组`}
                    aria-expanded={!collapsed.has(group.key)}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                  >
                    <ChevronDown size={13} />
                    <span>{group.label}</span>
                    <span className="asset-group-count">
                      {group.items.length}
                    </span>
                  </button>
                </h3>
              )}
              {(!collapsed.has(group.key) ||
                preferences.grouping === "none") && (
                <>
                  {preferences.view === "list" && (
                    <div className="asset-list-heading" aria-hidden="true">
                      <span>名称</span>
                      <span>时长</span>
                    </div>
                  )}
                  <div
                    className={
                      preferences.view === "grid" ? "asset-grid" : "asset-list"
                    }
                  >
                    {group.items.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        selected={selectedId === asset.id}
                        libraryId={libraryId}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          ))
        )}
      </div>
      <div className="media-browser-footer">
        <button className="media-import-button" onClick={onImport}>
          <Plus size={16} />
          {libraryId ? "导入到库" : "导入媒体"}
        </button>
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
      {menu && menuAsset && (
        <MediaContextMenu
          menu={menu}
          onClose={closeMenu}
          unavailable={unavailable(menuAsset)}
          onCommand={(command) => onCommand(menuAsset, command)}
          onSaveToLibrary={
            onSaveToLibrary ? () => onSaveToLibrary(menuAsset) : undefined
          }
          commands={
            libraryId
              ? [
                  ["add", "添加到时间线"],
                  ["delete", "从素材库移除…"],
                ]
              : undefined
          }
        />
      )}
    </div>
  );
}
