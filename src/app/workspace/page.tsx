"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { PixelButton } from "@/components/PixelButton";
import { PixelSvgPreview } from "@/components/editor/PixelSvgPreview";
import {
  addWorkspaceItem,
  createWorkspace,
  createWorkspaceItemFromDocument,
  deleteSelectedWorkspaceItems,
  duplicateSelectedWorkspaceItems,
  getWorkspaceItemDisplaySize,
  moveSelectedWorkspaceItems,
  normalizeWorkspaceItemDisplaySizes,
  selectWorkspaceItem,
  selectWorkspaceItems,
  toggleWorkspaceItemSelection,
  updateWorkspaceItem
} from "@/domain/workspace/document";
import type { CanvasWorkspace, WorkspaceItem, WorkspaceSummary } from "@/domain/workspace/types";
import {
  createSmartSelection,
  getPixelMap,
  pixelKey,
  updatePixels
} from "@/domain/sprite/document";
import {
  createSpriteDocumentFromPng,
  getPngImportSource,
  repixelizeSpriteDocumentFromPng,
  type ImportPaletteSize
} from "@/domain/sprite/importPng";
import { exportDocumentPng, renderDocumentThumbnail } from "@/domain/sprite/render";
import type { SpriteSize } from "@/domain/sprite/types";
import { downloadDataUrl } from "@/lib/download";
import {
  deleteWorkspace,
  listWorkspaceSummaries,
  loadWorkspace,
  saveWorkspace
} from "@/lib/storage/projects";

type WorkspaceTool = "select" | "brush" | "eraser" | "eyedropper" | "fill" | "magic";

const workspaceName = "像素无限画布";
const gridSizes: SpriteSize[] = [16, 32, 64, 128, 256];
const paletteSizes: ImportPaletteSize[] = [8, 16, 32, 64, 128, 256, 512];
const brushSizes = [1, 2, 4, 8];
const defaultGridSize: SpriteSize = 64;
const defaultPaletteSize: ImportPaletteSize = 32;
const defaultEditColor = "#111827";
const workspaceStorageKey = "pixel-canvas-active-workspace-id";
const canvasBaseWidth = 12000;
const canvasBaseHeight = 8000;
const exportScales = [1, 2, 3, 4, 8] as const;
const workspaceItemPadding = 0;
const zoomSteps = [
  0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.33,
  0.4, 0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.33, 1.5, 1.67,
  1.8, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32,
  48, 64
];
const minCanvasScale = zoomSteps[0];
const maxCanvasScale = zoomSteps[zoomSteps.length - 1];
const wheelZoomSensitivity = 0.007;
const pixelEditTools: WorkspaceTool[] = ["brush", "eraser", "eyedropper", "fill", "magic"];
const autoSaveDelay = 800;
type SaveState = "saved" | "pending" | "saving" | "error";
type WorkspaceContextMenu = {
  x: number;
  y: number;
};

function getItemPreview(item: WorkspaceItem) {
  return renderDocumentThumbnail(item.spriteDocument, 256, {
    showCheckerboard: false
  });
}

function formatZoom(scale: number) {
  const percent = scale * 100;
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function getNextZoomStep(currentScale: number, direction: 1 | -1) {
  const currentIndex = zoomSteps.reduce((nearestIndex, step, index) => {
    const nearestDistance = Math.abs(zoomSteps[nearestIndex] - currentScale);
    const currentDistance = Math.abs(step - currentScale);
    return currentDistance < nearestDistance ? index : nearestIndex;
  }, 0);

  return direction > 0
    ? zoomSteps[Math.min(zoomSteps.length - 1, currentIndex + 1)]
    : zoomSteps[Math.max(0, currentIndex - 1)];
}

export default function WorkspacePage() {
  const [workspace, setWorkspace] = useState<CanvasWorkspace | null>(null);
  const [workspaceSummaries, setWorkspaceSummaries] = useState<WorkspaceSummary[]>([]);
  const [status, setStatus] = useState("正在准备像素无限画布...");
  const [isImporting, setIsImporting] = useState(false);
  const [isRepixelizing, setIsRepixelizing] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [activeTool, setActiveTool] = useState<WorkspaceTool>("select");
  const [editColor, setEditColor] = useState(defaultEditColor);
  const [brushSize, setBrushSize] = useState(1);
  const [showPixelGrid, setShowPixelGrid] = useState(true);
  const [isPastingImage, setIsPastingImage] = useState(false);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [copiedItemCount, setCopiedItemCount] = useState(0);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(null);
  const [magicSelection, setMagicSelection] = useState<{
    itemId: string;
    keys: string[];
  } | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    itemId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const selectedMoveStartRef = useRef<{
    selectedIds: string[];
    startClientX: number;
    startClientY: number;
    startPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const panStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const pixelPaintRef = useRef<{
    pointerId: number;
    itemId: string;
    color: string | null;
    touchedKeys: Set<string>;
    lastPoint: { x: number; y: number };
  } | null>(null);
  const copiedItemIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<CanvasWorkspace[]>([]);
  const redoStackRef = useRef<CanvasWorkspace[]>([]);
  const canvasScaleRef = useRef(1);
  const itemPreviewCacheRef = useRef(
    new Map<string, { document: WorkspaceItem["spriteDocument"]; preview: string }>()
  );
  const latestWorkspaceRef = useRef<CanvasWorkspace | null>(null);
  const lastSavedWorkspaceRef = useRef<CanvasWorkspace | null>(null);
  const workspaceSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const isWorkspaceReadyRef = useRef(false);
  const wheelZoomRef = useRef<{
    frameId: number | null;
    deltaY: number;
    point: { clientX: number; clientY: number } | null;
  }>({
    frameId: null,
    deltaY: 0,
    point: null
  });

  const isHandActive = isSpacePressed;
  const isPixelEditTool = ["brush", "eraser", "eyedropper", "fill", "magic"].includes(
    activeTool
  );

  async function refreshWorkspaceSummaries() {
    const summaries = await listWorkspaceSummaries();
    setWorkspaceSummaries(summaries);
    return summaries;
  }

  useEffect(() => {
    void refreshWorkspaceSummaries().catch(() => {
      setStatus("画布列表读取失败，请刷新重试");
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreWorkspace() {
      const savedWorkspaceId = window.localStorage.getItem(workspaceStorageKey);
      if (savedWorkspaceId) {
        const savedWorkspace = await loadWorkspace(savedWorkspaceId);
        if (savedWorkspace && !cancelled) {
          const normalizedWorkspace = normalizeWorkspaceItemDisplaySizes(savedWorkspace);
          latestWorkspaceRef.current = normalizedWorkspace;
          lastSavedWorkspaceRef.current = savedWorkspace;
          isWorkspaceReadyRef.current = true;
          setWorkspace(normalizedWorkspace);
          setSaveState(normalizedWorkspace === savedWorkspace ? "saved" : "pending");
          setStatus(`已恢复工作区：${savedWorkspace.items.length} 个对象`);
          return;
        }
        if (!cancelled) {
          setStatus("找不到上次保存的工作区，未创建空白画布以免覆盖数据。请刷新重试。");
          setSaveState("error");
          return;
        }
      }
      if (!cancelled) {
        const nextWorkspace = createWorkspace(workspaceName);
        latestWorkspaceRef.current = nextWorkspace;
        lastSavedWorkspaceRef.current = nextWorkspace;
        isWorkspaceReadyRef.current = true;
        setWorkspace(nextWorkspace);
        setSaveState("saved");
        setStatus("画布已就绪。导入图片后会自动像素化为独立对象。");
      }
    }

    restoreWorkspace().catch(() => {
      if (!cancelled) {
        setStatus("工作区恢复失败，未覆盖原有数据。请刷新重试或检查浏览器存储权限。");
        setSaveState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistWorkspace = useCallback(async (target: CanvasWorkspace) => {
    setSaveState("saving");
    const saveTask = workspaceSaveQueueRef.current.then(() => saveWorkspace(target));
    workspaceSaveQueueRef.current = saveTask.catch(() => undefined);

    try {
      const summary = await saveTask;
      lastSavedWorkspaceRef.current = target;
      window.localStorage.setItem(workspaceStorageKey, target.id);
      setWorkspaceSummaries((current) =>
        [summary, ...current.filter((item) => item.id !== summary.id)].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      );
      if (latestWorkspaceRef.current === target) setSaveState("saved");
      return summary;
    } catch (error) {
      if (latestWorkspaceRef.current === target) {
        setSaveState("error");
        setStatus(
          error instanceof Error
            ? `保存失败：${error.message}`
            : "保存失败，请检查浏览器存储空间或权限"
        );
      }
      return null;
    }
  }, []);

  useEffect(() => {
    latestWorkspaceRef.current = workspace;
    if (
      !workspace ||
      !isWorkspaceReadyRef.current ||
      lastSavedWorkspaceRef.current === workspace
    ) {
      return;
    }

    setSaveState("pending");
    const timer = window.setTimeout(() => {
      void persistWorkspace(workspace);
    }, autoSaveDelay);
    return () => window.clearTimeout(timer);
  }, [workspace, persistWorkspace]);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (!workspace || lastSavedWorkspaceRef.current === workspace) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [workspace]);

  useEffect(() => {
    function closeContextMenu() {
      setContextMenu(null);
    }

    window.addEventListener("pointerdown", closeContextMenu);
    return () => window.removeEventListener("pointerdown", closeContextMenu);
  }, []);

  useEffect(() => {
    canvasScaleRef.current = canvasScale;
  }, [canvasScale]);

  const selectedItem = useMemo(() => {
    if (!workspace) return null;
    return (
      workspace.items.find((item) =>
        workspace.selectedItemIds.includes(item.id)
      ) ?? null
    );
  }, [workspace]);

  const itemPreviews = useMemo(() => {
    const cache = itemPreviewCacheRef.current;
    const items = workspace?.items ?? [];
    const activeIds = new Set(items.map((item) => item.id));

    for (const itemId of cache.keys()) {
      if (!activeIds.has(itemId)) cache.delete(itemId);
    }

    return new Map(
      items.map((item) => {
        const cached = cache.get(item.id);
        if (cached?.document === item.spriteDocument) {
          return [item.id, cached.preview] as const;
        }

        const preview = getItemPreview(item);
        cache.set(item.id, { document: item.spriteDocument, preview });
        return [item.id, preview] as const;
      })
    );
  }, [workspace?.items]);

  const selectedMagicSelection =
    selectedItem && magicSelection?.itemId === selectedItem.id
      ? new Set(magicSelection.keys)
      : null;

  function updateWorkspace(
    nextWorkspace: CanvasWorkspace,
    nextStatus?: string,
    options?: { history?: boolean }
  ) {
    if (options?.history && workspace) {
      undoStackRef.current = [...undoStackRef.current.slice(-39), workspace];
      redoStackRef.current = [];
    }
    setWorkspace(nextWorkspace);
    if (nextStatus) setStatus(nextStatus);
  }

  function getViewportCenterItemPosition() {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 96, y: 96 };

    return {
      x: Math.max(
        0,
        (viewport.scrollLeft + viewport.clientWidth / 2) / canvasScaleRef.current - 128
      ),
      y: Math.max(
        0,
        (viewport.scrollTop + viewport.clientHeight / 2) / canvasScaleRef.current - 128
      )
    };
  }

  async function addImageFileToWorkspace(
    file: File,
    origin: "import" | "paste",
    position?: { x: number; y: number }
  ) {
    if (!workspace) return;

    const actionLabel = origin === "paste" ? "粘贴" : "导入";
    const document = await createSpriteDocumentFromPng(file, defaultGridSize, {
      paletteSize: defaultPaletteSize
    });
    const source = getPngImportSource(document);
    const fallbackColumn = workspace.items.length % 3;
    const fallbackRow = Math.floor(workspace.items.length / 3);
    const pastedPosition = position ?? getViewportCenterItemPosition();
    const item = createWorkspaceItemFromDocument({
      document,
      x: origin === "paste" ? pastedPosition.x : 96 + fallbackColumn * 320,
      y: origin === "paste" ? pastedPosition.y : 96 + fallbackRow * 320,
      gridSize: defaultGridSize,
      paletteSize: defaultPaletteSize,
      source: {
        fileName: source?.originalFileName ?? file.name,
        dataUrl: source?.originalPngDataUrl,
        mimeType: file.type
      }
    });

    updateWorkspace(
      addWorkspaceItem(workspace, item),
      `已${actionLabel}「${file.name}」为 ${defaultGridSize}x${defaultGridSize} 像素对象`,
      origin === "paste" ? { history: true } : undefined
    );
  }

  function setActiveWorkspaceTool(tool: WorkspaceTool) {
    setActiveTool(tool);
    if (!pixelEditTools.includes(tool)) {
      setMagicSelection(null);
    }
  }

  function undoWorkspaceEdit() {
    const previous = undoStackRef.current.at(-1);
    if (!previous || !workspace) {
      setStatus("没有可撤销的编辑");
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-39), workspace];
    setWorkspace(previous);
    setMagicSelection(null);
    setStatus("已撤销上一步编辑");
  }

  function redoWorkspaceEdit() {
    const next = redoStackRef.current.at(-1);
    if (!next || !workspace) {
      setStatus("没有可重做的编辑");
      return;
    }
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-39), workspace];
    setWorkspace(next);
    setMagicSelection(null);
    setStatus("已重做编辑");
  }

  const setCanvasScaleAroundPoint = useCallback(
    (nextScale: number, point?: { clientX: number; clientY: number }) => {
      const viewport = viewportRef.current;
      const clampedScale = Math.min(
        maxCanvasScale,
        Math.max(minCanvasScale, Number(nextScale.toFixed(4)))
      );
      if (!viewport) {
        setCanvasScale(clampedScale);
        canvasScaleRef.current = clampedScale;
        return;
      }

      const previousScale = canvasScaleRef.current;
      const rect = viewport.getBoundingClientRect();
      const anchorX = point ? point.clientX - rect.left : viewport.clientWidth / 2;
      const anchorY = point ? point.clientY - rect.top : viewport.clientHeight / 2;
      const worldX = (viewport.scrollLeft + anchorX) / previousScale;
      const worldY = (viewport.scrollTop + anchorY) / previousScale;

      flushSync(() => {
        setCanvasScale(clampedScale);
      });
      canvasScaleRef.current = clampedScale;
      viewport.scrollLeft = worldX * clampedScale - anchorX;
      viewport.scrollTop = worldY * clampedScale - anchorY;
    },
    []
  );

  function zoomCanvas(direction: 1 | -1) {
    setCanvasScaleAroundPoint(getNextZoomStep(canvasScale, direction));
  }

  function resetCanvasZoom() {
    setCanvasScaleAroundPoint(1);
  }

  function fitCanvasToItems() {
    const viewport = viewportRef.current;
    if (!viewport || !workspace?.items.length) {
      setCanvasScaleAroundPoint(1);
      return;
    }

    const padding = 160;
    const minX = Math.min(...workspace.items.map((item) => item.x));
    const minY = Math.min(...workspace.items.map((item) => item.y));
    const maxX = Math.max(...workspace.items.map((item) => item.x + item.width));
    const maxY = Math.max(...workspace.items.map((item) => item.y + item.height));
    const contentWidth = Math.max(1, maxX - minX + padding * 2);
    const contentHeight = Math.max(1, maxY - minY + padding * 2);
    const nextScale = Math.min(
      1,
      viewport.clientWidth / contentWidth,
      viewport.clientHeight / contentHeight
    );

    setCanvasScale(Math.max(minCanvasScale, Math.min(maxCanvasScale, nextScale)));
    window.requestAnimationFrame(() => {
      const scale = Math.max(minCanvasScale, Math.min(maxCanvasScale, nextScale));
      viewport.scrollLeft = Math.max(0, (minX - padding) * scale);
      viewport.scrollTop = Math.max(0, (minY - padding) * scale);
    });
    setStatus("已适应全部对象");
  }

  function fitCanvasToSelected() {
    const viewport = viewportRef.current;
    if (!viewport || !selectedItem) {
      fitCanvasToItems();
      return;
    }

    const padding = 120;
    const contentWidth = selectedItem.width + padding * 2;
    const contentHeight = selectedItem.height + padding * 2;
    const nextScale = Math.min(
      maxCanvasScale,
      Math.max(
        minCanvasScale,
        Math.min(viewport.clientWidth / contentWidth, viewport.clientHeight / contentHeight)
      )
    );

    setCanvasScale(nextScale);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (selectedItem.x - padding) * nextScale);
      viewport.scrollTop = Math.max(0, (selectedItem.y - padding) * nextScale);
    });
    setStatus("已适应选中对象");
  }

  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const target = event.target;
      if (!(target instanceof Node) || !viewport.contains(target)) return;
      if (!event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      event.stopPropagation();
      wheelZoomRef.current.deltaY += event.deltaY;
      wheelZoomRef.current.point = {
        clientX: event.clientX,
        clientY: event.clientY
      };
      if (wheelZoomRef.current.frameId !== null) return;

      wheelZoomRef.current.frameId = window.requestAnimationFrame(() => {
        const { deltaY, point } = wheelZoomRef.current;
        wheelZoomRef.current.deltaY = 0;
        wheelZoomRef.current.frameId = null;
        if (!point) return;

        // 滚轮和触控板都按连续倍率缩放；每一帧清空累计值，避免旧方向残留。
        const multiplier = Math.exp(-deltaY * wheelZoomSensitivity);
        setCanvasScaleAroundPoint(
          canvasScaleRef.current * multiplier,
          point
        );
      });
    }

    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false
    });
    return () => {
      if (wheelZoomRef.current.frameId !== null) {
        window.cancelAnimationFrame(wheelZoomRef.current.frameId);
      }
      window.removeEventListener("wheel", handleWheel, {
        capture: true
      });
    };
  }, [setCanvasScaleAroundPoint]);

  useEffect(() => {
    function preventBrowserGesture(event: Event) {
      const viewport = viewportRef.current;
      const target = event.target;
      if (!viewport || !(target instanceof Node) || !viewport.contains(target)) return;
      event.preventDefault();
    }

    window.addEventListener("gesturestart", preventBrowserGesture, {
      capture: true
    });
    window.addEventListener("gesturechange", preventBrowserGesture, {
      capture: true
    });
    window.addEventListener("gestureend", preventBrowserGesture, {
      capture: true
    });
    return () => {
      window.removeEventListener("gesturestart", preventBrowserGesture, {
        capture: true
      });
      window.removeEventListener("gesturechange", preventBrowserGesture, {
        capture: true
      });
      window.removeEventListener("gestureend", preventBrowserGesture, {
        capture: true
      });
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);
      if (isTyping) return;

      if (event.code === "Space") {
        event.preventDefault();
        setIsSpacePressed(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoWorkspaceEdit();
        } else {
          undoWorkspaceEdit();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomCanvas(1);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        zoomCanvas(-1);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        fitCanvasToItems();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "1") {
        event.preventDefault();
        resetCanvasZoom();
      }
      if (event.shiftKey && event.key === "1") {
        event.preventDefault();
        fitCanvasToItems();
      }
      if (event.shiftKey && event.key === "2") {
        event.preventDefault();
        fitCanvasToSelected();
      }
      if (event.key.toLowerCase() === "v") {
        setActiveWorkspaceTool("select");
      }
      if (event.key.toLowerCase() === "b") {
        setActiveWorkspaceTool("brush");
      }
      if (event.key.toLowerCase() === "e") {
        setActiveWorkspaceTool("eraser");
      }
      if (event.key.toLowerCase() === "i") {
        setActiveWorkspaceTool("eyedropper");
        setStatus("吸色：点击当前对象中的颜色");
      }
      if (event.key.toLowerCase() === "g") {
        setActiveWorkspaceTool("fill");
      }
      if (event.key.toLowerCase() === "w") {
        setActiveWorkspaceTool("magic");
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        setIsSpacePressed(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [fitCanvasToItems, fitCanvasToSelected, workspace]);

  async function handleImportImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !workspace) return;

    setIsImporting(true);
    setStatus(`正在导入并像素化「${file.name}」...`);

    try {
      await addImageFileToWorkspace(file, "import");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片导入失败");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  useEffect(() => {
    async function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);
      if (isTyping || !workspace) return;

      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) {
        if (!copiedItemIdsRef.current.length) return;
        event.preventDefault();
        pasteCopiedWorkspaceItems();
        return;
      }

      event.preventDefault();
      setMagicSelection(null);
      setIsPastingImage(true);
      const pastedFile = new File(
        [file],
        `粘贴图片-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
        { type: file.type || "image/png" }
      );
      setStatus(`正在粘贴并像素化「${pastedFile.name}」...`);

      try {
        await addImageFileToWorkspace(pastedFile, "paste");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "图片粘贴失败");
      } finally {
        setIsPastingImage(false);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [workspace]);

  async function handleSaveWorkspace() {
    if (!workspace) return;
    const summary = await persistWorkspace(workspace);
    if (summary) setStatus(`已保存工作区：${summary.itemCount} 个对象`);
  }

  function resetWorkspaceEditingState() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    copiedItemIdsRef.current = [];
    setCopiedItemCount(0);
    setMagicSelection(null);
    setMarquee(null);
    setContextMenu(null);
  }

  async function activateWorkspace(id: string, options?: { saveCurrent?: boolean }) {
    if (id === workspace?.id || (isSwitchingWorkspace && options?.saveCurrent !== false)) return;
    setIsSwitchingWorkspace(true);
    try {
      if (options?.saveCurrent !== false && workspace) {
        const saved = await persistWorkspace(workspace);
        if (!saved) return;
      }

      const savedWorkspace = await loadWorkspace(id);
      if (!savedWorkspace) {
        setStatus("找不到所选画布，请刷新画布列表后重试");
        await refreshWorkspaceSummaries();
        return;
      }

      const normalizedWorkspace = normalizeWorkspaceItemDisplaySizes(savedWorkspace);
      latestWorkspaceRef.current = normalizedWorkspace;
      lastSavedWorkspaceRef.current = savedWorkspace;
      window.localStorage.setItem(workspaceStorageKey, normalizedWorkspace.id);
      resetWorkspaceEditingState();
      setWorkspace(normalizedWorkspace);
      setSaveState(normalizedWorkspace === savedWorkspace ? "saved" : "pending");
      setStatus(`已切换到画布「${normalizedWorkspace.name}」`);
      await refreshWorkspaceSummaries();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "切换画布失败");
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  async function handleCreateWorkspace() {
    const name = window.prompt("输入新画布名称", "新画布");
    if (name === null) return;

    const nextWorkspace = createWorkspace(name.trim() || "新画布");
    setIsSwitchingWorkspace(true);
    try {
      if (workspace) {
        const saved = await persistWorkspace(workspace);
        if (!saved) return;
      }
      latestWorkspaceRef.current = nextWorkspace;
      lastSavedWorkspaceRef.current = nextWorkspace;
      window.localStorage.setItem(workspaceStorageKey, nextWorkspace.id);
      resetWorkspaceEditingState();
      setWorkspace(nextWorkspace);
      await persistWorkspace(nextWorkspace);
      setSaveState("saved");
      setStatus(`已新建画布「${nextWorkspace.name}」`);
      await refreshWorkspaceSummaries();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "新建画布失败");
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!workspace) return;
    const name = window.prompt("输入画布名称", workspace.name);
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("画布名称不能为空");
      return;
    }
    if (trimmedName === workspace.name) return;

    const renamedWorkspace = { ...workspace, name: trimmedName };
    latestWorkspaceRef.current = renamedWorkspace;
    setWorkspace(renamedWorkspace);
    const summary = await persistWorkspace(renamedWorkspace);
    if (summary) setStatus(`画布已重命名为「${trimmedName}」`);
  }

  async function handleDeleteWorkspace() {
    if (!workspace || isSwitchingWorkspace) return;
    const summaries = await refreshWorkspaceSummaries();
    if (summaries.length <= 1) {
      setStatus("至少保留一个画布，不能删除最后一个画布");
      return;
    }
    const confirmed = window.confirm(
      `确认删除画布「${workspace.name}」吗？其中的对象将无法恢复。`
    );
    if (!confirmed) return;

    const nextSummary = summaries.find((item) => item.id !== workspace.id);
    if (!nextSummary) return;

    setIsSwitchingWorkspace(true);
    try {
      const saved = await persistWorkspace(workspace);
      if (!saved) return;
      await deleteWorkspace(workspace.id);
      await activateWorkspace(nextSummary.id, { saveCurrent: false });
      setStatus(`已删除画布「${workspace.name}」`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除画布失败");
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  async function handleRepixelize(size: SpriteSize, paletteSize: ImportPaletteSize) {
    if (!workspace || !selectedItem) return;
    setMagicSelection(null);
    setIsRepixelizing(true);
    setStatus(`正在重新像素化：${size}x${size} · ${paletteSize} 色...`);

    try {
      const document = await repixelizeSpriteDocumentFromPng(
        selectedItem.spriteDocument,
        size,
        { paletteSize }
      );
      const nextWorkspace = updateWorkspaceItem(workspace, selectedItem.id, (item) => ({
        ...item,
        width: getWorkspaceItemDisplaySize(size),
        height: getWorkspaceItemDisplaySize(size),
        pixelSettings: {
          gridSize: size,
          paletteSize
        },
        spriteDocument: document
      }));
      updateWorkspace(nextWorkspace, `已重新像素化：${size}x${size} · ${paletteSize} 色`, {
        history: true
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "重新像素化失败");
    } finally {
      setIsRepixelizing(false);
    }
  }

  function exportWorkspaceItems(items: WorkspaceItem[], scale: (typeof exportScales)[number]) {
    if (!items.length) {
      setStatus("请先选中要导出的图像");
      return;
    }

    items.forEach((item) => {
      const size = item.spriteDocument.canvas.width;
      const outputSize = size * scale;
      downloadDataUrl(
        `${item.name}-${outputSize}x${outputSize}.png`,
        exportDocumentPng(item.spriteDocument, {
        scale,
        backgroundColor: null
        })
      );
    });

    const scaleLabel = `${scale}×`;
    setStatus(
      items.length === 1
        ? `已导出「${items[0].name}」：${scaleLabel}`
        : `已批量导出 ${items.length} 个对象：${scaleLabel}`
    );
  }

  function handleExportSelected(scale: (typeof exportScales)[number] = 1) {
    if (!selectedItem) {
      setStatus("请先选中一个像素对象");
      return;
    }
    exportWorkspaceItems([selectedItem], scale);
  }

  function handleExportSelectedItems(scale: (typeof exportScales)[number]) {
    if (!workspace) return;
    const selectedIds = new Set(workspace.selectedItemIds);
    exportWorkspaceItems(
      workspace.items.filter((item) => selectedIds.has(item.id)),
      scale
    );
  }

  function selectItem(itemId: string | null) {
    if (!workspace) return;
    setMagicSelection(null);
    updateWorkspace(selectWorkspaceItem(workspace, itemId));
  }

  function handleRenameSelectedItem() {
    if (!workspace || !selectedItem) return;
    setContextMenu(null);
    const name = window.prompt("输入图片名称", selectedItem.name);
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("图片名称不能为空");
      return;
    }
    if (trimmedName === selectedItem.name) return;

    updateWorkspace(
      updateWorkspaceItem(workspace, selectedItem.id, (item) => ({
        ...item,
        name: trimmedName
      })),
      `已将图片重命名为「${trimmedName}」`,
      { history: true }
    );
  }

  function copySelectedWorkspaceItems() {
    if (!workspace?.selectedItemIds.length) {
      setStatus("请先点击选中要复制的图像");
      return;
    }
    copiedItemIdsRef.current = workspace.selectedItemIds;
    setCopiedItemCount(workspace.selectedItemIds.length);
    setContextMenu(null);
    setStatus(`已复制 ${workspace.selectedItemIds.length} 个对象，可在右键菜单粘贴或按 Cmd/Ctrl+V`);
  }

  function deleteSelectedWorkspaceItemsWithHistory() {
    if (!workspace?.selectedItemIds.length) {
      setStatus("请先选中要删除的图像");
      return;
    }
    setMagicSelection(null);
    setContextMenu(null);
    updateWorkspace(deleteSelectedWorkspaceItems(workspace), "已删除选中对象，可按 Cmd/Ctrl+Z 撤回", {
      history: true
    });
  }

  function pasteCopiedWorkspaceItems() {
    if (!workspace) return;
    if (!copiedItemIdsRef.current.length) {
      setStatus("请先选中图像并点击复制");
      return;
    }
    const pasteWorkspace = selectWorkspaceItems(workspace, copiedItemIdsRef.current);
    setContextMenu(null);
    updateWorkspace(duplicateSelectedWorkspaceItems(pasteWorkspace), "已粘贴对象", {
      history: true
    });
  }

  function getCanvasPoint(event: { clientX: number; clientY: number }) {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const rect = viewport.getBoundingClientRect();
    return {
      x: (viewport.scrollLeft + event.clientX - rect.left) / canvasScale,
      y: (viewport.scrollTop + event.clientY - rect.top) / canvasScale
    };
  }

  function getMarqueeItemIds(selection: NonNullable<typeof marquee>) {
    if (!workspace) return [];
    const selectionRight = selection.x + selection.width;
    const selectionBottom = selection.y + selection.height;

    return workspace.items
      .filter((item) => {
        const itemRight = item.x + item.width;
        const itemBottom = item.y + item.height;
        return (
          item.x < selectionRight &&
          itemRight > selection.x &&
          item.y < selectionBottom &&
          itemBottom > selection.y
        );
      })
      .map((item) => item.id);
  }

  function getItemPixelPoint(event: ReactPointerEvent, item: WorkspaceItem) {
    const canvasPoint = getCanvasPoint(event);
    const contentX = item.x + workspaceItemPadding;
    const contentY = item.y + workspaceItemPadding;
    const contentWidth = item.width - workspaceItemPadding * 2;
    const contentHeight = item.height - workspaceItemPadding * 2;
    const localX = canvasPoint.x - contentX;
    const localY = canvasPoint.y - contentY;
    const pixelX = Math.floor((localX / contentWidth) * item.spriteDocument.canvas.width);
    const pixelY = Math.floor((localY / contentHeight) * item.spriteDocument.canvas.height);

    if (
      pixelX < 0 ||
      pixelY < 0 ||
      pixelX >= item.spriteDocument.canvas.width ||
      pixelY >= item.spriteDocument.canvas.height
    ) {
      return null;
    }

    return { x: pixelX, y: pixelY };
  }

  function getBrushChanges(item: WorkspaceItem, x: number, y: number, color: string | null) {
    const changes: Array<{ x: number; y: number; color: string | null }> = [];
    const offset = Math.floor(brushSize / 2);
    for (let brushY = 0; brushY < brushSize; brushY += 1) {
      for (let brushX = 0; brushX < brushSize; brushX += 1) {
        const nextX = x + brushX - offset;
        const nextY = y + brushY - offset;
        if (
          nextX < 0 ||
          nextY < 0 ||
          nextX >= item.spriteDocument.canvas.width ||
          nextY >= item.spriteDocument.canvas.height
        ) {
          continue;
        }
        const key = pixelKey(nextX, nextY);
        if (selectedMagicSelection && !selectedMagicSelection.has(key)) continue;
        changes.push({ x: nextX, y: nextY, color });
      }
    }
    return changes;
  }

  function getLinePoints(start: { x: number; y: number }, end: { x: number; y: number }) {
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1);
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index <= steps; index += 1) {
      points.push({
        x: Math.round(start.x + ((end.x - start.x) * index) / steps),
        y: Math.round(start.y + ((end.y - start.y) * index) / steps)
      });
    }
    return points;
  }

  function getSelectionCellBorders(
    key: string,
    selectionKeys: Set<string>,
    item: WorkspaceItem
  ) {
    const [x, y] = key.split(",").map(Number);
    return {
      ["--selection-border-top" as string]:
        y <= 0 || !selectionKeys.has(pixelKey(x, y - 1)) ? "2px" : "0px",
      ["--selection-border-right" as string]:
        x >= item.spriteDocument.canvas.width - 1 || !selectionKeys.has(pixelKey(x + 1, y))
          ? "2px"
          : "0px",
      ["--selection-border-bottom" as string]:
        y >= item.spriteDocument.canvas.height - 1 || !selectionKeys.has(pixelKey(x, y + 1))
          ? "2px"
          : "0px",
      ["--selection-border-left" as string]:
        x <= 0 || !selectionKeys.has(pixelKey(x - 1, y)) ? "2px" : "0px"
    };
  }

  function getPaintCursor(item: WorkspaceItem) {
    if (
      workspace?.selectedItemIds.length !== 1 ||
      selectedItem?.id !== item.id ||
      !isPixelEditTool
    ) {
      return undefined;
    }

    if (activeTool === "brush") {
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M19 3 25 9 10 24 4 18Z' fill='%23fff' stroke='%23111827' stroke-width='2'/%3E%3Cpath d='M4 18c-1 2-1 4-1 7 3 0 5 0 7-1Z' fill='%23111827'/%3E%3C/svg%3E") 3 25, crosshair`;
    }

    if (activeTool === "eraser") {
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 28 28'%3E%3Cpath d='M9 5h11l5 5-12 12H6l-4-4Z' fill='%23fff' stroke='%23111827' stroke-width='2'/%3E%3Cpath d='M8 22h17' stroke='%23111827' stroke-width='2'/%3E%3C/svg%3E") 3 15, crosshair`;
    }

    return "crosshair";
  }

  function getFillChanges(item: WorkspaceItem, x: number, y: number, color: string | null) {
    const pixels = getPixelMap(item.spriteDocument);
    const seedKey = pixelKey(x, y);
    const seedColor = pixels[seedKey] ?? null;
    if (seedColor === color) return [];

    const visited = new Set<string>();
    const changes: Array<{ x: number; y: number; color: string | null }> = [];
    const queue = [{ x, y }];

    while (queue.length) {
      const point = queue.shift();
      if (!point) break;
      if (
        point.x < 0 ||
        point.y < 0 ||
        point.x >= item.spriteDocument.canvas.width ||
        point.y >= item.spriteDocument.canvas.height
      ) {
        continue;
      }

      const key = pixelKey(point.x, point.y);
      if (visited.has(key)) continue;
      visited.add(key);
      if (selectedMagicSelection && !selectedMagicSelection.has(key)) continue;
      if ((pixels[key] ?? null) !== seedColor) continue;

      changes.push({ x: point.x, y: point.y, color });
      queue.push(
        { x: point.x + 1, y: point.y },
        { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 },
        { x: point.x, y: point.y - 1 }
      );
    }

    return changes;
  }

  function applyPixelChanges(
    item: WorkspaceItem,
    changes: Array<{ x: number; y: number; color: string | null }>,
    message: string,
    options?: { history?: boolean }
  ) {
    if (!changes.length) return;
    setWorkspace((currentWorkspace) => {
      if (!currentWorkspace) return currentWorkspace;
      if (options?.history ?? true) {
        undoStackRef.current = [...undoStackRef.current.slice(-39), currentWorkspace];
        redoStackRef.current = [];
      }
      return updateWorkspaceItem(currentWorkspace, item.id, (workspaceItem) => ({
        ...workspaceItem,
        spriteDocument: updatePixels(workspaceItem.spriteDocument, changes)
      }));
    });
    setStatus(message);
  }

  function clearSelectedPixels() {
    if (!selectedItem || !selectedMagicSelection?.size) {
      setStatus("请先用魔棒选中要清空的区域");
      return;
    }

    applyPixelChanges(
      selectedItem,
      Array.from(selectedMagicSelection).map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y, color: null };
      }),
      `已清空选区内容：${selectedMagicSelection.size} 个像素`,
      { history: true }
    );
  }

  function handlePixelEditPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    item: WorkspaceItem
  ) {
    if (!workspace || !isPixelEditTool || workspace.selectedItemIds.length !== 1) return;
    const point = getItemPixelPoint(event, item);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();

    if (activeTool === "eyedropper") {
      const color = getPixelMap(item.spriteDocument)[pixelKey(point.x, point.y)];
      if (color) {
        setEditColor(color);
        setActiveWorkspaceTool("brush");
        setStatus(`已吸取颜色：${color}`);
      } else {
        setStatus("这里是透明像素，请点击其他颜色");
      }
      return;
    }

    if (activeTool === "magic") {
      const keys = createSmartSelection(item.spriteDocument, point.x, point.y);
      if (!keys.length) {
        setStatus("没有可选中的像素");
        return;
      }

      const canAddToSelection = event.shiftKey && magicSelection?.itemId === item.id;
      const nextKeys = canAddToSelection
        ? Array.from(new Set([...magicSelection.keys, ...keys]))
        : keys;
      setMagicSelection({ itemId: item.id, keys: nextKeys });
      setStatus(
        canAddToSelection
          ? `已追加选区，共 ${nextKeys.length} 个像素`
          : `已选中 ${nextKeys.length} 个像素`
      );
      return;
    }

    if (activeTool === "fill") {
      applyPixelChanges(
        item,
        getFillChanges(item, point.x, point.y, editColor),
        "已填充像素区域"
      );
      return;
    }

    const color = activeTool === "eraser" ? null : editColor;
    pixelPaintRef.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      color,
      touchedKeys: new Set([pixelKey(point.x, point.y)]),
      lastPoint: point
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    applyPixelChanges(
      item,
      getBrushChanges(item, point.x, point.y, color),
      activeTool === "eraser" ? "已擦除像素" : "已绘制像素",
      { history: true }
    );
  }

  function handlePixelEditPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    item: WorkspaceItem
  ) {
    const paint = pixelPaintRef.current;
    if (!paint || paint.itemId !== item.id || paint.pointerId !== event.pointerId) return;
    const point = getItemPixelPoint(event, item);
    if (!point) return;
    const points = getLinePoints(paint.lastPoint, point);
    const changes = points.flatMap((linePoint) => {
      const key = pixelKey(linePoint.x, linePoint.y);
      if (paint.touchedKeys.has(key)) return [];
      paint.touchedKeys.add(key);
      return getBrushChanges(item, linePoint.x, linePoint.y, paint.color);
    });
    paint.lastPoint = point;
    if (!changes.length) return;
    applyPixelChanges(
      item,
      changes,
      paint.color ? "已绘制像素" : "已擦除像素",
      { history: false }
    );
  }

  function finishPixelPaint(event: ReactPointerEvent<HTMLButtonElement>) {
    const paint = pixelPaintRef.current;
    if (!paint) return;
    if (event.currentTarget.hasPointerCapture(paint.pointerId)) {
      event.currentTarget.releasePointerCapture(paint.pointerId);
    }
    pixelPaintRef.current = null;
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);
      if (isTyping || !workspace) return;

      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;
      if (isModifier && key === "z") return;
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelectedWorkspaceItemsWithHistory();
      }
      if (isModifier && key === "c") {
        event.preventDefault();
        copySelectedWorkspaceItems();
      }
      if (isModifier && key === "d") {
        event.preventDefault();
        updateWorkspace(duplicateSelectedWorkspaceItems(workspace), "已复制选中对象", {
          history: true
        });
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const delta = {
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 }
        }[event.key] ?? { x: 0, y: 0 };
        updateWorkspace(
          moveSelectedWorkspaceItems(workspace, delta.x, delta.y),
          "已移动选中对象",
          { history: true }
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [workspace]);

  function handleItemPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    item: WorkspaceItem
  ) {
    if (!workspace || item.locked) return;
    if (event.button === 1) {
      event.preventDefault();
      return;
    }
    if (isHandActive) return;
    if (isPixelEditTool && workspace.selectedItemIds.length === 1 && selectedItem?.id === item.id) {
      handlePixelEditPointerDown(event, item);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextWorkspace =
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleWorkspaceItemSelection(workspace, item.id)
        : workspace.selectedItemIds.includes(item.id)
          ? workspace
          : selectWorkspaceItem(workspace, item.id);
    setWorkspace(nextWorkspace);
    setDraggingItemId(item.id);
    const selectedIds = nextWorkspace.selectedItemIds.includes(item.id)
      ? nextWorkspace.selectedItemIds
      : [item.id];
    selectedMoveStartRef.current = {
      selectedIds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions: Object.fromEntries(
        nextWorkspace.items
          .filter((workspaceItem) => selectedIds.includes(workspaceItem.id))
          .map((workspaceItem) => [
            workspaceItem.id,
            { x: workspaceItem.x, y: workspaceItem.y }
          ])
      )
    };
    dragStartRef.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (isHandActive || event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
      panStartRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop
      };
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(event);
    if (isPixelEditTool) {
      setStatus("请先选中一个像素对象，再在对象内部编辑");
      return;
    }
    setMarquee({
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0
    });
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
      selectItem(null);
    }
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const panStart = panStartRef.current;
    if (viewport && panStart) {
      viewport.scrollLeft = panStart.startScrollLeft - (event.clientX - panStart.startClientX);
      viewport.scrollTop = panStart.startScrollTop - (event.clientY - panStart.startClientY);
      return;
    }

    if (marquee) {
      const point = getCanvasPoint(event);
      setMarquee({
        ...marquee,
        x: Math.min(marquee.startX, point.x),
        y: Math.min(marquee.startY, point.y),
        width: Math.abs(point.x - marquee.startX),
        height: Math.abs(point.y - marquee.startY)
      });
    }
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const panStart = panStartRef.current;
    if (panStart && event.currentTarget.hasPointerCapture(panStart.pointerId)) {
      event.currentTarget.releasePointerCapture(panStart.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
    if (marquee && workspace) {
      const itemIds = getMarqueeItemIds(marquee);
      const nextIds =
        event.shiftKey || event.metaKey || event.ctrlKey
          ? Array.from(new Set([...workspace.selectedItemIds, ...itemIds]))
          : itemIds;
      setMagicSelection(null);
      updateWorkspace(selectWorkspaceItems(workspace, nextIds));
      setMarquee(null);
    }
  }

  function handleItemPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const currentItem = workspace?.items.find(
      (item) => item.id === pixelPaintRef.current?.itemId
    );
    if (currentItem && pixelPaintRef.current) {
      handlePixelEditPointerMove(event, currentItem);
      return;
    }
    const dragStart = dragStartRef.current;
    const selectedMoveStart = selectedMoveStartRef.current;
    if (!workspace || !dragStart || !selectedMoveStart) return;
    const deltaX = (event.clientX - dragStart.startClientX) / canvasScale;
    const deltaY = (event.clientY - dragStart.startClientY) / canvasScale;
    const selectedIds = new Set(selectedMoveStart.selectedIds);

    setWorkspace(
      {
        ...workspace,
        items: workspace.items.map((item) => {
          if (!selectedIds.has(item.id)) return item;
          const start = selectedMoveStart.startPositions[item.id];
          return {
            ...item,
            x: start.x + deltaX,
            y: start.y + deltaY
          };
        })
      }
    );
  }

  function finishItemDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pixelPaintRef.current) {
      finishPixelPaint(event);
      return;
    }
    const dragStart = dragStartRef.current;
    if (!dragStart) return;
    if (event.currentTarget.hasPointerCapture(dragStart.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStart.pointerId);
    }
    dragStartRef.current = null;
    selectedMoveStartRef.current = null;
    setDraggingItemId(null);
    if (workspace) {
      undoStackRef.current = [...undoStackRef.current.slice(-39), workspace];
      redoStackRef.current = [];
    }
    setStatus("已移动对象，有未保存修改");
  }

  if (!workspace) {
    return (
      <main className="workspace-page">
        <div className="loading-panel">{status}</div>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <strong>像素无限画布</strong>
          <span>Pixel Canvas</span>
        </div>
        <div className="workspace-actions">
          <label className={`pixel-file-button ${isImporting || isPastingImage ? "disabled" : ""}`}>
            <strong>
              {isPastingImage ? "粘贴中..." : isImporting ? "导入中..." : "导入图片"}
            </strong>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={isImporting || isPastingImage}
              onChange={handleImportImage}
            />
          </label>
          <PixelButton
            variant="secondary"
            onClick={handleSaveWorkspace}
            disabled={!workspace || saveState === "saving"}
          >
            {saveState === "saving" ? "保存中..." : saveState === "error" ? "重试保存" : "保存画布"}
          </PixelButton>
          <PixelButton onClick={() => handleExportSelected(1)} disabled={!selectedItem}>
            导出当前对象
          </PixelButton>
        </div>
      </header>

      <section className="workspace-shell">
        <aside className="workspace-layer-panel">
          <section className="workspace-canvas-manager" aria-label="画布管理">
            <div className="panel-title-row workspace-canvas-title-row">
              <h2>画布</h2>
              <button
                aria-label="新建画布"
                disabled={isSwitchingWorkspace}
                onClick={() => void handleCreateWorkspace()}
                type="button"
              >
                +
              </button>
            </div>
            <select
              aria-label="选择画布"
              disabled={isSwitchingWorkspace}
              onChange={(event) => void activateWorkspace(event.target.value)}
              value={workspace.id}
            >
              {workspaceSummaries.length ? (
                workspaceSummaries.map((summary) => (
                  <option key={summary.id} value={summary.id}>
                    {summary.name}
                  </option>
                ))
              ) : (
                <option value={workspace.id}>{workspace.name}</option>
              )}
            </select>
            <div className="workspace-canvas-actions">
              <button
                disabled={isSwitchingWorkspace}
                onClick={() => void handleRenameWorkspace()}
                type="button"
              >
                重命名
              </button>
              <button
                className="danger"
                disabled={isSwitchingWorkspace || workspaceSummaries.length <= 1}
                onClick={() => void handleDeleteWorkspace()}
                type="button"
              >
                删除
              </button>
            </div>
          </section>
          <div className="panel-title-row">
            <h2>对象</h2>
            <span>{workspace.items.length}</span>
          </div>
          {workspace.items.length ? (
            <div className="workspace-item-list">
              {[...workspace.items]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((item) => (
                  <button
                    key={item.id}
                    className={workspace.selectedItemIds.includes(item.id) ? "active" : ""}
                    onClick={() => selectItem(item.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!workspace.selectedItemIds.includes(item.id)) {
                        setMagicSelection(null);
                        setWorkspace(selectWorkspaceItem(workspace, item.id));
                      }
                      setContextMenu({ x: event.clientX, y: event.clientY });
                    }}
                    type="button"
                  >
                    <img src={itemPreviews.get(item.id) ?? ""} alt="" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.pixelSettings.gridSize}x{item.pixelSettings.gridSize}</small>
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <p className="workspace-empty-note">
              先导入一张图片。每张图片都会变成独立像素对象。
            </p>
          )}
        </aside>

        <section className="infinite-canvas-panel" aria-label="像素无限画布">
          <div className="workspace-zoom-controls" aria-label="画布查看缩放">
            <button onClick={() => zoomCanvas(-1)} type="button" aria-label="缩小画布">
              -
            </button>
            <button onClick={resetCanvasZoom} type="button">
              {formatZoom(canvasScale)}
            </button>
            <button onClick={() => zoomCanvas(1)} type="button" aria-label="放大画布">
              +
            </button>
            <button onClick={fitCanvasToItems} type="button">
              适应
            </button>
          </div>
          <div className="workspace-tool-strip" aria-label="画布工具">
            <button
              className={activeTool === "select" ? "active" : ""}
              onClick={() => setActiveWorkspaceTool("select")}
              title="选择工具 V"
              type="button"
            >
              选择
            </button>
            <button
              className={activeTool === "brush" ? "active" : ""}
              onClick={() => setActiveWorkspaceTool("brush")}
              title="笔刷 B：编辑当前选中的像素对象"
              type="button"
            >
              笔刷
            </button>
            <button
              className={activeTool === "eraser" ? "active" : ""}
              onClick={() => setActiveWorkspaceTool("eraser")}
              title="橡皮 E：擦除当前对象内的像素"
              type="button"
            >
              橡皮
            </button>
            <button
              className={activeTool === "fill" ? "active" : ""}
              onClick={() => setActiveWorkspaceTool("fill")}
              title="油漆桶 G：填充相邻同色区域"
              type="button"
            >
              填充
            </button>
            <button
              className={activeTool === "magic" ? "active" : ""}
              onClick={() => setActiveWorkspaceTool("magic")}
              title="魔棒 W：选择相近像素区域；按住 Shift 点击可追加选区"
              type="button"
            >
              魔棒
            </button>
            <button onClick={undoWorkspaceEdit} title="撤销 Cmd/Ctrl+Z" type="button">
              撤销
            </button>
            <button onClick={redoWorkspaceEdit} title="重做 Cmd/Ctrl+Shift+Z" type="button">
              重做
            </button>
          </div>
          <div
            ref={viewportRef}
            className={`canvas-viewport ${isHandActive ? "hand-active" : ""} ${
              isPanning ? "panning" : ""
            }`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={finishCanvasPan}
            onPointerCancel={finishCanvasPan}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                x: event.clientX,
                y: event.clientY
              });
            }}
            style={{
              ["--canvas-scale" as string]: canvasScale,
              ["--canvas-width" as string]: `${canvasBaseWidth}px`,
              ["--canvas-height" as string]: `${canvasBaseHeight}px`
            }}
          >
            <div className="canvas-scaled-stage">
              <div className="canvas-grid-surface">
                {workspace.items.map((item) => {
                  const isSelected = workspace.selectedItemIds.includes(item.id);
                  const gridCellSize = Math.min(
                    (item.width * canvasScale) / item.spriteDocument.canvas.width,
                    (item.height * canvasScale) / item.spriteDocument.canvas.height
                  );
                  const itemMagicSelection =
                    magicSelection?.itemId === item.id
                      ? new Set(magicSelection.keys)
                      : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`workspace-canvas-item ${isSelected ? "active" : ""} ${
                        draggingItemId === item.id ? "dragging" : ""
                      }`}
                      style={{
                        left: item.x * canvasScale,
                        top: item.y * canvasScale,
                        width: item.width * canvasScale,
                        height: item.height * canvasScale,
                        zIndex: item.zIndex + 1,
                        cursor: getPaintCursor(item)
                      }}
                      onPointerDown={(event) => {
                        if (!isHandActive) {
                          event.stopPropagation();
                        }
                        handleItemPointerDown(event, item);
                      }}
                      onPointerMove={handleItemPointerMove}
                      onPointerUp={finishItemDrag}
                      onPointerCancel={finishItemDrag}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!workspace.selectedItemIds.includes(item.id)) {
                          setWorkspace(selectWorkspaceItem(workspace, item.id));
                        }
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY
                        });
                      }}
                    >
                      <PixelSvgPreview
                        className="workspace-vector-preview"
                        document={item.spriteDocument}
                        showGrid={showPixelGrid}
                        gridCellSize={gridCellSize}
                      />
                      {itemMagicSelection?.size ? (
                        <div
                          className="workspace-pixel-selection"
                          style={{
                            ["--pixel-columns" as string]: item.spriteDocument.canvas.width,
                            ["--pixel-rows" as string]: item.spriteDocument.canvas.height
                          }}
                          aria-hidden="true"
                        >
                          {Array.from(itemMagicSelection).map((key) => {
                            const [pixelX, pixelY] = key.split(",").map(Number);
                            return (
                              <i
                                key={key}
                                style={{
                                  gridColumnStart: pixelX + 1,
                                  gridRowStart: pixelY + 1,
                                  ...getSelectionCellBorders(key, itemMagicSelection, item)
                                }}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                      <span>{item.pixelSettings.gridSize}x{item.pixelSettings.gridSize}</span>
                    </button>
                  );
                })}
                {marquee ? (
                  <div
                    className="workspace-marquee"
                    style={{
                      left: marquee.x * canvasScale,
                      top: marquee.y * canvasScale,
                      width: marquee.width * canvasScale,
                      height: marquee.height * canvasScale
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div className="workspace-status">
            {status} · {saveState === "saved" ? "已保存" : saveState === "pending" ? "等待自动保存" : saveState === "saving" ? "保存中" : "保存失败"}
          </div>
        </section>

        <aside className="workspace-inspector">
          {workspace.selectedItemIds.length > 1 ? (
            <section>
              <h2>{workspace.selectedItemIds.length} 个对象已选中</h2>
              <p>可以一起拖动、方向键微移、复制粘贴、删除或按同一倍率批量导出 PNG。</p>
              <h3>批量导出 PNG</h3>
              <div className="workspace-export-actions">
                {exportScales.map((scale) => (
                  <button
                    key={scale}
                    onClick={() => handleExportSelectedItems(scale)}
                    type="button"
                  >
                    {scale}×
                  </button>
                ))}
              </div>
              <div className="workspace-export-actions">
                <button
                  onClick={deleteSelectedWorkspaceItemsWithHistory}
                  type="button"
                >
                  删除
                </button>
              </div>
            </section>
          ) : selectedItem ? (
            <>
              <section>
                <div className="workspace-item-name-row">
                  <h2 className="workspace-item-name">{selectedItem.name}</h2>
                  <button onClick={handleRenameSelectedItem} type="button">
                    重命名
                  </button>
                </div>
                <div className="workspace-preview">
                  <img
                    src={itemPreviews.get(selectedItem.id) ?? ""}
                    alt={selectedItem.name}
                  />
                </div>
              </section>
              <section>
                <h3>对象内编辑</h3>
                <div className="workspace-edit-controls">
                  <label>
                    颜色
                    <input
                      type="color"
                      value={editColor}
                      onChange={(event) => setEditColor(event.target.value)}
                    />
                  </label>
                  <div>
                    <span>笔刷大小</span>
                    <div className="workspace-option-grid compact">
                      {brushSizes.map((size) => (
                        <button
                          key={size}
                          className={brushSize === size ? "active" : ""}
                          onClick={() => setBrushSize(size)}
                          type="button"
                        >
                          {size}px
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className={showPixelGrid ? "active" : ""}
                    onClick={() => setShowPixelGrid((value) => !value)}
                    type="button"
                  >
                    {showPixelGrid ? "隐藏网格" : "显示网格"}
                  </button>
                  {selectedMagicSelection ? (
                    <div className="workspace-selection-actions">
                      <button onClick={clearSelectedPixels} type="button">
                        清空选区内容（{selectedMagicSelection.size} 像素）
                      </button>
                      <button
                        className="workspace-clear-selection"
                        onClick={() => setMagicSelection(null)}
                        type="button"
                      >
                        取消选区
                      </button>
                    </div>
                  ) : (
                    <p>工具会编辑当前选中的像素对象，不会影响其他对象。</p>
                  )}
                </div>
              </section>
              <section>
                <h3>像素分辨率</h3>
                <div className="workspace-option-grid">
                  {gridSizes.map((size) => (
                    <button
                      key={size}
                      className={
                        selectedItem.pixelSettings.gridSize === size ? "active" : ""
                      }
                      disabled={isRepixelizing}
                      onClick={() =>
                        handleRepixelize(size, selectedItem.pixelSettings.paletteSize)
                      }
                      type="button"
                    >
                      {size}x{size}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3>颜色数量</h3>
                <select
                  value={selectedItem.pixelSettings.paletteSize}
                  disabled={isRepixelizing}
                  onChange={(event) => {
                    const paletteSize = Number(event.target.value) as ImportPaletteSize;
                    if (!paletteSizes.includes(paletteSize)) return;
                    handleRepixelize(selectedItem.pixelSettings.gridSize, paletteSize);
                  }}
                >
                  {paletteSizes.map((size) => (
                    <option key={size} value={size}>
                      {size} 色
                    </option>
                  ))}
                </select>
                <p>默认偏游戏像素画感。色数越低，越干净；色数越高，越接近原图。</p>
              </section>
              <section>
                <h3>导出 PNG</h3>
                <div className="workspace-export-actions">
                  {exportScales.map((scale) => (
                    <button
                      key={scale}
                      onClick={() => handleExportSelected(scale)}
                      type="button"
                    >
                      {scale}×
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="workspace-empty-note">
              <h2>未选中对象</h2>
              <p>导入图片后，点击画布里的对象，就能调分辨率、颜色数量和导出。</p>
            </section>
          )}
        </aside>
      </section>
      {contextMenu ? (
        <div
          className="workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={copySelectedWorkspaceItems}
            disabled={!workspace?.selectedItemIds.length}
            type="button"
          >
            复制
            <span>Cmd/Ctrl+C</span>
          </button>
          <button onClick={pasteCopiedWorkspaceItems} disabled={!copiedItemCount} type="button">
            粘贴
            <span>Cmd/Ctrl+V</span>
          </button>
          <button
            disabled={workspace?.selectedItemIds.length !== 1}
            onClick={handleRenameSelectedItem}
            type="button"
          >
            重命名
          </button>
          <button
            className="danger"
            disabled={!workspace?.selectedItemIds.length}
            onClick={deleteSelectedWorkspaceItemsWithHistory}
            type="button"
          >
            删除
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
