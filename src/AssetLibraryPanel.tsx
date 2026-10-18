import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Film, Library, X } from "lucide-react";
import type { Asset } from "../shared/model";
import {
  defaultAssetLibraryId,
  type AssetLibrary,
} from "../shared/asset-libraries";
import MediaLibrary, { type MediaLibraryProps } from "./MediaLibrary";
import "./AssetLibraryPanel.css";

type Request = {
  kind: "create" | "rename" | "delete" | "save" | "remove";
  asset?: Asset;
};
function desktop() {
  if (!window.framecraft) throw new Error("素材库管理需要运行桌面版");
  return window.framecraft;
}
function savedLibrary() {
  try {
    return (
      localStorage.getItem("troncut.selected-asset-library") ??
      defaultAssetLibraryId
    );
  } catch {
    return defaultAssetLibraryId;
  }
}

function LibraryDialog({
  request,
  library,
  libraries,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  request: Request;
  library?: AssetLibrary;
  libraries: AssetLibrary[];
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    request.kind === "rename"
      ? (library?.name ?? "")
      : request.kind === "save"
        ? (library?.id ?? defaultAssetLibraryId)
        : "",
  );
  const title = {
    create: "创建新库",
    rename: "重命名库",
    delete: "删除库",
    save: "添加到素材库",
    remove: "从素材库移除",
  }[request.kind];
  const destructive = request.kind === "delete" || request.kind === "remove";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.select();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="asset-library-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <div className="modal-heading">
          <h3>{title}</h3>
          <button
            type="button"
            aria-label="关闭素材库对话框"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {destructive ? (
          <p>
            {request.kind === "delete"
              ? `确定删除“${library?.name}”及其中的 ${library?.assets.length ?? 0} 个素材？已加入工程的素材仍会保留。`
              : `确定从库中移除“${request.asset?.name}”？已加入工程的素材仍会保留。`}
          </p>
        ) : request.kind === "save" ? (
          <label className="field">
            目标素材库
            <select
              aria-label="目标素材库"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            >
              {libraries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            库名称
            <input
              autoFocus
              aria-label="库名称"
              maxLength={100}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="asset-library-error" role="alert">
            {error}
          </p>
        )}
        <div className="asset-library-dialog-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button
            type="submit"
            className={destructive ? "danger" : "primary"}
            disabled={pending || (!destructive && !value.trim())}
          >
            {pending ? "正在处理…" : destructive ? "确认删除" : "确定"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

export default function AssetLibraryPanel(
  props: MediaLibraryProps & {
    toast: (message: string) => void;
    busy: boolean;
  },
) {
  const [tab, setTab] = useState<"project" | "library">("project");
  const [libraries, setLibraries] = useState<AssetLibrary[]>([]);
  const [selected, setSelected] = useState(savedLibrary);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<Request | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const library =
    libraries.find((item) => item.id === selected) ?? libraries[0];
  const refresh = useCallback(async () => {
    const next = await desktop().assetLibraries();
    setLibraries(next);
    return next;
  }, []);
  useEffect(() => {
    if (window.framecraft)
      void refresh().catch((error) => setError(String(error)));
  }, [refresh]);
  useEffect(() => {
    if (!library) return;
    try {
      localStorage.setItem("troncut.selected-asset-library", library.id);
    } catch {
      /* Optional preference. */
    }
  }, [library?.id]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, []);
  const act = async (action: () => Promise<void>) => {
    if (lock.current || props.busy) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const show = (request: Request) => {
    if (menu.current) menu.current.open = false;
    setError("");
    setRequest(request);
  };
  const useAsset = (asset: Asset) =>
    void act(async () => {
      if (!library) return;
      if (asset.missing) throw new Error("库中素材文件缺失，请移除后重新导入");
      props.onActivate(await desktop().useLibraryAsset(library.id, asset.id));
    });
  const submit = (value: string) =>
    void act(async () => {
      if (!request) return;
      const api = desktop();
      if (request.kind === "create") {
        setSelected(await api.createAssetLibrary(value));
      } else if (request.kind === "rename" && library) {
        await api.renameAssetLibrary(library.id, value);
      } else if (request.kind === "delete" && library) {
        await api.deleteAssetLibrary(library.id);
        setSelected(defaultAssetLibraryId);
      } else if (request.kind === "remove" && library && request.asset) {
        await api.removeLibraryAsset(library.id, request.asset.id);
      } else if (request.kind === "save" && request.asset) {
        await api.addLibraryAssets(value, [request.asset.id]);
        setSelected(value);
        props.toast("已添加到素材库，可在其他工程复用");
      }
      await refresh();
      setRequest(null);
    });
  const disabled = pending || props.busy;
  const visibleAssets =
    tab === "project" ? props.assets : (library?.assets ?? []);
  return (
    <>
      <div className="library-heading">
        <h2>{tab === "project" ? "项目媒体" : "素材库"}</h2>
        <span>{visibleAssets.length} 个素材</span>
      </div>
      <div className="media-panel-tabs" role="tablist" aria-label="媒体来源">
        <button
          role="tab"
          id="project-media-tab"
          aria-controls="media-source-panel"
          aria-selected={tab === "project"}
          onClick={() => {
            setTab("project");
            props.onQueryChange("");
          }}
        >
          <Film size={15} />
          项目媒体
        </button>
        <button
          role="tab"
          id="asset-library-tab"
          aria-controls="media-source-panel"
          aria-selected={tab === "library"}
          onClick={() => {
            setTab("library");
            props.onQueryChange("");
          }}
        >
          <Library size={15} />
          素材库
        </button>
      </div>
      {tab === "library" && (
        <div className="asset-library-selector">
          <label htmlFor="asset-library-select">库</label>
          <select
            id="asset-library-select"
            aria-label="当前素材库"
            value={library?.id ?? ""}
            disabled={disabled || !library}
            onChange={(event) => {
              setSelected(event.target.value);
              props.onQueryChange("");
            }}
          >
            {!library && <option value="">正在加载…</option>}
            {libraries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <details
            ref={menu}
            className="asset-library-management"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                menu.current!.open = false;
                menu.current?.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="管理库" title="管理库">
              管理
              <ChevronDown size={12} />
            </summary>
            <div role="menu" aria-label="管理素材库">
              <button
                role="menuitem"
                disabled={disabled || !library}
                onClick={() => show({ kind: "rename" })}
              >
                重命名库…
              </button>
              <button
                role="menuitem"
                disabled={
                  disabled || !library || library.id === defaultAssetLibraryId
                }
                onClick={() => show({ kind: "delete" })}
              >
                删除库…
              </button>
              <button
                role="menuitem"
                disabled={disabled || !library}
                onClick={() => {
                  menu.current!.open = false;
                  void act(async () => {
                    if (
                      library &&
                      (await desktop().exportAssetLibrary(library.id))
                    )
                      props.toast("素材库已导出，包含全部素材文件");
                  });
                }}
              >
                导出库…
              </button>
              <hr />
              <button
                role="menuitem"
                disabled={disabled}
                onClick={() => show({ kind: "create" })}
              >
                创建新库…
              </button>
              <button
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  menu.current!.open = false;
                  void act(async () => {
                    const id = await desktop().importAssetLibrary();
                    if (!id) return;
                    await refresh();
                    setSelected(id);
                    props.toast("素材库已导入");
                  });
                }}
              >
                导入压缩库…
              </button>
            </div>
          </details>
        </div>
      )}
      {error && !request && (
        <p className="asset-library-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="media-source-panel"
        role="tabpanel"
        id="media-source-panel"
        aria-labelledby={
          tab === "project" ? "project-media-tab" : "asset-library-tab"
        }
        aria-busy={pending}
      >
        <MediaLibrary
          key={tab === "library" ? (library?.id ?? "loading") : "project"}
          {...props}
          assets={visibleAssets}
          libraryId={tab === "library" ? (library?.id ?? "loading") : undefined}
          onSaveToLibrary={
            tab === "project"
              ? (asset) => show({ kind: "save", asset })
              : undefined
          }
          onActivate={tab === "project" ? props.onActivate : useAsset}
          onCommand={
            tab === "project"
              ? props.onCommand
              : (asset, command) => {
                  if (command === "add") useAsset(asset);
                  else if (command === "delete")
                    show({ kind: "remove", asset });
                }
          }
          unavailable={
            tab === "project"
              ? props.unavailable
              : (asset) => (asset.missing ? { add: "素材文件缺失" } : {})
          }
          onImport={
            tab === "project"
              ? props.onImport
              : () =>
                  void act(async () => {
                    if (!library) return;
                    const assets = await desktop().importMedia();
                    if (!assets.length) return;
                    await desktop().addLibraryAssets(
                      library.id,
                      assets.map((asset) => asset.id),
                    );
                    await refresh();
                    props.toast(
                      `已添加 ${assets.length} 个素材到“${library.name}”`,
                    );
                  })
          }
        />
      </div>
      {request && (
        <LibraryDialog
          request={request}
          library={library}
          libraries={libraries}
          pending={pending}
          error={error}
          onClose={() => setRequest(null)}
          onSubmit={submit}
        />
      )}
    </>
  );
}
