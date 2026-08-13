"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PixelButton } from "@/components/PixelButton";
import { SpriteCanvas } from "@/components/editor/SpriteCanvas";
import {
  addOrUpdateBackgroundLayer,
  createSmartSelection,
  getPixelMap,
  pixelKey,
  removeDetectedBackgroundColor,
  setActiveLayer,
  toggleLayerVisibility,
  updatePixels
} from "@/domain/sprite/document";
import {
  getPngImportSource,
  repixelizeSpriteDocumentFromPng,
  type ImportPaletteSize
} from "@/domain/sprite/importPng";
import { exportDocumentPng } from "@/domain/sprite/render";
import type { SpriteDocument, SpriteSize } from "@/domain/sprite/types";
import { downloadDataUrl, downloadText } from "@/lib/download";
import { loadProject, saveProject } from "@/lib/storage/projects";

const maxUndoSteps = 50;
type StrokeChange = { x: number; y: number; color: string | null };
type BrushPopoverTool = "brush" | "eraser" | null;
type ExportScaleMode = "original" | "preview";
type ExportBackgroundMode = "transparent" | "selected";
const minBrushSize = 1;
const maxBrushSize = 8;
const repixelizeSizes: SpriteSize[] = [16, 32, 64, 128, 256];
const repixelizePaletteSizes: ImportPaletteSize[] = [8, 16, 32, 64, 128, 256, 512];
const autoSaveDelay = 800;
type SaveState = "saved" | "pending" | "saving" | "error";

export default function EditorPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [document, setDocument] = useState<SpriteDocument | null>(null);
  const [status, setStatus] = useState("读取项目...");
  const [selectedColor, setSelectedColor] = useState("#374151");
  const [eraseMode, setEraseMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionKeys, setSelectionKeys] = useState<string[]>([]);
  const [selectionInverted, setSelectionInverted] = useState(false);
  const [brushSize, setBrushSize] = useState(minBrushSize);
  const [exportScaleMode, setExportScaleMode] =
    useState<ExportScaleMode>("original");
  const [exportBackgroundMode, setExportBackgroundMode] =
    useState<ExportBackgroundMode>("transparent");
  const [brushPopoverTool, setBrushPopoverTool] = useState<BrushPopoverTool>(null);
  const [editingBackgroundColor, setEditingBackgroundColor] = useState<string | null>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [repixelizeSize, setRepixelizeSize] = useState<SpriteSize>(64);
  const [repixelizePaletteSize, setRepixelizePaletteSize] =
    useState<ImportPaletteSize>(32);
  const [isRepixelizing, setIsRepixelizing] = useState(false);
  const [undoStack, setUndoStack] = useState<SpriteDocument[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const strokeStartDocumentRef = useRef<SpriteDocument | null>(null);
  const strokeChangesRef = useRef<StrokeChange[]>([]);
  const repixelizeRequestRef = useRef(0);
  const latestDocumentRef = useRef<SpriteDocument | null>(null);
  const lastSavedDocumentRef = useRef<SpriteDocument | null>(null);
  const documentSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const isDocumentReadyRef = useRef(false);

  useEffect(() => {
    async function load() {
      try {
        const loaded = await loadProject(projectId);
        if (!loaded) {
          setStatus("项目不存在或读取失败");
          setSaveState("error");
          return;
        }
        latestDocumentRef.current = loaded;
        lastSavedDocumentRef.current = loaded;
        isDocumentReadyRef.current = true;
        setDocument(loaded);
        setSaveState("saved");
        const importSource = getPngImportSource(loaded);
        setRepixelizeSize(importSource?.importGridSize ?? loaded.canvas.width);
        setRepixelizePaletteSize(
          isImportPaletteSize(importSource?.importPaletteSize)
            ? importSource.importPaletteSize
            : 32
        );
        setUndoStack([]);
        setSelectionMode(false);
        setSelectionKeys([]);
        setSelectionInverted(false);
        strokeStartDocumentRef.current = null;
        strokeChangesRef.current = [];
        setStatus("已读取，可继续编辑");
      } catch (error) {
        setStatus(error instanceof Error ? `读取失败：${error.message}` : "读取项目失败，请刷新重试");
        setSaveState("error");
      }
    }
    load();
  }, [projectId]);

  function isImportPaletteSize(value: unknown): value is ImportPaletteSize {
    return repixelizePaletteSizes.includes(value as ImportPaletteSize);
  }

  const activeAnimation = useMemo(() => {
    if (!document) return null;
    return (
      document.animations.find((animation) => animation.id === document.activeAnimationId) ??
      document.animations[0]
    );
  }, [document]);

  const activeLayer = useMemo(() => {
    if (!document) return null;
    return (
      document.layers.find((layer) => layer.id === document.activeLayerId) ??
      document.layers[0]
    );
  }, [document]);

  const sourceLabel = useMemo(() => {
    if (!document) return "未知来源";
    return (document.sources[document.sources.length - 1]?.label ?? "未知来源").replace(
      "文字生成占位",
      "旧版素材"
    );
  }, [document]);

  const pngImportSource = useMemo(() => {
    if (!document) return null;
    return getPngImportSource(document) ?? null;
  }, [document]);

  const editableMask = useMemo(() => {
    if (!selectionKeys.length) return null;
    return new Set(selectionKeys);
  }, [selectionKeys]);

  const persistDocument = useCallback(async (target: SpriteDocument) => {
    setSaveState("saving");
    const saveTask = documentSaveQueueRef.current.then(() => saveProject(target));
    documentSaveQueueRef.current = saveTask.catch(() => undefined);

    try {
      await saveTask;
      lastSavedDocumentRef.current = target;
      if (latestDocumentRef.current === target) setSaveState("saved");
      return true;
    } catch (error) {
      if (latestDocumentRef.current === target) {
        setSaveState("error");
        setStatus(
          error instanceof Error
            ? `保存失败：${error.message}`
            : "保存失败，请检查浏览器存储空间或权限"
        );
      }
      return false;
    }
  }, []);

  useEffect(() => {
    latestDocumentRef.current = document;
    if (
      !document ||
      !isDocumentReadyRef.current ||
      lastSavedDocumentRef.current === document
    ) {
      return;
    }

    setSaveState("pending");
    const timer = window.setTimeout(() => {
      void persistDocument(document);
    }, autoSaveDelay);
    return () => window.clearTimeout(timer);
  }, [document, persistDocument]);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (!document || lastSavedDocumentRef.current === document) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [document]);

  async function handleSave() {
    if (!document) return;
    const saved = await persistDocument(document);
    if (saved) setStatus("已保存");
  }

  const handleUndo = useCallback(() => {
    if (!undoStack.length) {
      setStatus("没有可撤回的操作");
      return;
    }

    const previousDocument = undoStack[undoStack.length - 1];
    setUndoStack((current) => current.slice(0, -1));
    setDocument(previousDocument);
    strokeStartDocumentRef.current = null;
    strokeChangesRef.current = [];
    setStatus("已撤回上一步，有未保存修改");
  }, [undoStack]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      const isUndoKey =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z";

      if (!isUndoKey || isEditingText) return;

      event.preventDefault();
      handleUndo();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo]);

  function handleStrokeStart() {
    if (!document) return;
    strokeStartDocumentRef.current = document;
    strokeChangesRef.current = [];
  }

  function getBrushPixels(x: number, y: number) {
    if (!document) return [];

    const offset = Math.floor(brushSize / 2);
    const startX = Math.max(0, x - offset);
    const startY = Math.max(0, y - offset);
    const endX = Math.min(document.canvas.width, startX + brushSize);
    const endY = Math.min(document.canvas.height, startY + brushSize);
    const pixels: Array<{ x: number; y: number }> = [];

    for (let nextY = startY; nextY < endY; nextY += 1) {
      for (let nextX = startX; nextX < endX; nextX += 1) {
        pixels.push({ x: nextX, y: nextY });
      }
    }

    return pixels;
  }

  function handlePixelChange(x: number, y: number, color: string | null) {
    const strokeStartDocument = strokeStartDocumentRef.current;
    if (!document || !strokeStartDocument) return;
    const previousChanges = strokeChangesRef.current;
    const nextChanges = [...previousChanges];
    const currentPixels = getPixelMap(document);
    const startingPixels = getPixelMap(strokeStartDocument);

    getBrushPixels(x, y).forEach((pixel) => {
      const key = pixelKey(pixel.x, pixel.y);
      if (editableMask?.size) {
        const isSelected = editableMask.has(key);
        const isEditable = selectionInverted ? !isSelected : isSelected;
        if (!isEditable) return;
      }

      const startingColor = startingPixels[key] ?? null;
      const currentColor = currentPixels[key] ?? null;
      if ((currentColor?.toLowerCase() ?? null) === (color?.toLowerCase() ?? null)) {
        return;
      }
      if ((startingColor?.toLowerCase() ?? null) === (color?.toLowerCase() ?? null)) {
        return;
      }

      const existingIndex = nextChanges.findIndex(
        (item) => item.x === pixel.x && item.y === pixel.y
      );
      const change = { x: pixel.x, y: pixel.y, color };
      if (existingIndex >= 0) {
        nextChanges[existingIndex] = change;
      } else {
        nextChanges.push(change);
      }
    });

    if (nextChanges.length === previousChanges.length) return;

    strokeChangesRef.current = nextChanges;
    setDocument(updatePixels(strokeStartDocument, nextChanges));
    setStatus("有未保存修改");
  }

  function handleStrokeEnd() {
    const strokeStartDocument = strokeStartDocumentRef.current;
    const strokeChanges = strokeChangesRef.current;
    if (!strokeStartDocument) return;

    if (strokeChanges.length) {
      setUndoStack((current) => [
        ...current.slice(-(maxUndoSteps - 1)),
        strokeStartDocument
      ]);
    }
    strokeStartDocumentRef.current = null;
    strokeChangesRef.current = [];
  }

  function handleExportJson() {
    if (!document) return;
    downloadText(`${document.name}.sprite.json`, JSON.stringify(document, null, 2));
  }

  function handleExportPng() {
    if (!document) return;
    const scale =
      exportScaleMode === "preview"
        ? Math.max(4, Math.floor(512 / document.canvas.width))
        : 1;
    const suffix =
      exportScaleMode === "preview"
        ? `${document.canvas.width * scale}px-preview`
        : `${document.canvas.width}x${document.canvas.height}`;
    const backgroundColor =
      exportBackgroundMode === "selected" ? selectedColor : null;

    downloadDataUrl(
      `${document.name}-${suffix}.png`,
      exportDocumentPng(document, {
        backgroundColor,
        scale
      })
    );
    setStatus(
      exportBackgroundMode === "selected"
        ? `已导出 PNG：${suffix}，背景 ${selectedColor}`
        : `已导出 PNG：${suffix}，透明背景`
    );
  }

  function handleRemoveBackground() {
    if (!document) return;
    const result = removeDetectedBackgroundColor(document);
    setDocument(result.document);
    setUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), document]);
    setStatus(
      result.removedColor
        ? `已去除背景色 ${result.removedColor}，移除 ${result.removedCount} 个像素`
        : "没有识别到可去除的背景色"
    );
  }

  function handleAddBackground() {
    if (!document) return;
    setUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), document]);
    setDocument(addOrUpdateBackgroundLayer(document, selectedColor));
    setStatus(`已增加背景色图层：${selectedColor}`);
  }

  function handleSmartSelect(x: number, y: number) {
    if (!document) return;
    const nextSelection = createSmartSelection(document, x, y);
    setSelectionKeys(nextSelection);
    setSelectionInverted(false);
    setStatus(
      nextSelection.length
        ? `已智能选取 ${nextSelection.length} 个像素格，画笔只会编辑选区内`
        : "没有识别到可选区域"
    );
  }

  function handleOpenBackgroundColorEditor() {
    if (!document) return;
    const backgroundLayer = document.layers.find((layer) => layer.name === "背景色");
    if (!backgroundLayer) return;
    const frame = document.frames.find((item) => item.id === document.activeFrameId) ?? document.frames[0];
    const firstColor = Object.values(frame.layerPixels[backgroundLayer.id] ?? {})[0] ?? selectedColor;

    setEditingBackgroundColor(firstColor);
    setSelectedColor(firstColor);
    setDocument(setActiveLayer(document, backgroundLayer.id));
    setStatus("正在编辑背景色");
  }

  function handleChangeBackgroundColor(color: string) {
    if (!document) return;
    setEditingBackgroundColor(color);
    setSelectedColor(color);
    setUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), document]);
    setDocument(addOrUpdateBackgroundLayer(document, color));
    setStatus(`已更新背景色：${color}`);
  }

  async function handleRepixelize(size: SpriteSize, paletteSize: ImportPaletteSize) {
    if (!document || !pngImportSource) return;

    const requestId = repixelizeRequestRef.current + 1;
    repixelizeRequestRef.current = requestId;
    const beforeDocument = document;

    setRepixelizeSize(size);
    setRepixelizePaletteSize(paletteSize);
    setIsRepixelizing(true);
    setStatus(`正在重新取色：${size}x${size} · ${paletteSize} 色...`);

    try {
      const nextDocument = await repixelizeSpriteDocumentFromPng(document, size, {
        paletteSize
      });
      if (repixelizeRequestRef.current !== requestId) return;

      setUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), beforeDocument]);
      setDocument(nextDocument);
      setStatus(`已重新取色：${size}x${size} · ${paletteSize} 色，有未保存修改`);
    } catch (error) {
      if (repixelizeRequestRef.current !== requestId) return;
      setStatus(error instanceof Error ? error.message : "重新取色失败");
    } finally {
      if (repixelizeRequestRef.current === requestId) {
        setIsRepixelizing(false);
      }
    }
  }

  function handleSelectLayer(layerId: string) {
    if (!document) return;
    setDocument(setActiveLayer(document, layerId));
    setStatus("已切换图层");
  }

  function handleToggleLayerVisibility(layerId: string) {
    if (!document) return;
    setUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), document]);
    setDocument(toggleLayerVisibility(document, layerId));
    setStatus("已切换图层显示状态");
  }

  if (!document) {
    return (
      <main className="editor-page">
        <div className="loading-panel">{status}</div>
      </main>
    );
  }

  return (
    <main className="editor-page">
      <header className="editor-topbar">
        <PixelButton variant="secondary" onClick={() => router.push("/projects")}>
          ← 存档
        </PixelButton>
        <div className="editor-meta">
          <span>项目：{document.name}</span>
          <span>尺寸：{document.canvas.width}x{document.canvas.height}</span>
          <span>动作：{activeAnimation?.name ?? "未命名"}</span>
          <span>状态：{status}</span>
          <span>
            保存：{saveState === "saved" ? "已保存" : saveState === "pending" ? "等待自动保存" : saveState === "saving" ? "保存中" : "保存失败"}
          </span>
        </div>
        <div className="editor-actions">
          <PixelButton
            variant="secondary"
            onClick={handleUndo}
            disabled={!undoStack.length}
            title="撤回（Cmd/Ctrl+Z）"
          >
            撤回
          </PixelButton>
          <PixelButton onClick={handleSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? "保存中..." : saveState === "error" ? "重试保存" : "保存"}
          </PixelButton>
          <PixelButton onClick={handleExportPng}>
            导出 PNG
          </PixelButton>
          <div className="editor-more-actions">
            <button
              type="button"
              onClick={() => setShowMoreActions((current) => !current)}
              aria-expanded={showMoreActions}
            >
              更多
            </button>
            {showMoreActions ? (
              <div className="editor-more-menu">
                <button
                  type="button"
                  onClick={() => {
                    handleExportJson();
                    setShowMoreActions(false);
                  }}
                >
                  导出 JSON
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="editor-shell">
        <aside className="tool-rail" aria-label="工具栏">
          <div className="tool-with-options">
            <button
              className={!eraseMode ? "active" : ""}
              onClick={() => {
                setEraseMode(false);
                setSelectionMode(false);
                setBrushPopoverTool(null);
              }}
            >
              画笔
            </button>
            <button
              className="tool-option-toggle"
              onClick={() => {
                setEraseMode(false);
                setSelectionMode(false);
                setBrushPopoverTool((current) => (current === "brush" ? null : "brush"));
              }}
              aria-label="打开画笔尺寸设置"
              aria-expanded={brushPopoverTool === "brush"}
            >
              ▶
            </button>
          </div>
          <div className="tool-with-options">
            <button
              className={eraseMode ? "active" : ""}
              onClick={() => {
                setEraseMode(true);
                setSelectionMode(false);
                setBrushPopoverTool(null);
              }}
            >
              橡皮
            </button>
            <button
              className="tool-option-toggle"
              onClick={() => {
                setEraseMode(true);
                setSelectionMode(false);
                setBrushPopoverTool((current) => (current === "eraser" ? null : "eraser"));
              }}
              aria-label="打开橡皮尺寸设置"
              aria-expanded={brushPopoverTool === "eraser"}
            >
              ▶
            </button>
          </div>
          {brushPopoverTool ? (
            <div className="brush-size-popover">
              <div className="brush-popover-top">
                <strong>{brushPopoverTool === "eraser" ? "橡皮" : "画笔"}</strong>
                <button
                  type="button"
                  onClick={() => setBrushPopoverTool(null)}
                  aria-label="关闭尺寸设置"
                >
                  ×
                </button>
              </div>
              <label className="brush-size-control">
                <span>
                  <strong>尺寸：</strong>
                  <strong>{brushSize}像素</strong>
                </span>
                <input
                  type="range"
                  min={minBrushSize}
                  max={maxBrushSize}
                  step={1}
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  aria-label="画笔和橡皮尺寸"
                />
              </label>
            </div>
          ) : null}
          <div className="tool-divider" />
          <button
            className={selectionMode ? "active" : ""}
            onClick={() => {
              setSelectionMode((current) => !current);
              setBrushPopoverTool(null);
            }}
            type="button"
          >
            智能选区
          </button>
          <div className="tool-divider" />
          <label>
            颜色
            <input
              type="color"
              value={selectedColor}
              onChange={(event) => {
                setSelectedColor(event.target.value);
                setEraseMode(false);
                setSelectionMode(false);
              }}
            />
          </label>
        </aside>

        <SpriteCanvas
          document={document}
          selectedColor={selectedColor}
          eraseMode={eraseMode}
          brushSize={brushSize}
          selectionMode={selectionMode}
          editableMask={editableMask}
          selectionInverted={selectionInverted}
          onPixelChange={handlePixelChange}
          onSmartSelect={handleSmartSelect}
          onStrokeStart={handleStrokeStart}
          onStrokeEnd={handleStrokeEnd}
        />

        <aside className="side-panel">
          {pngImportSource ? (
            <section className="primary-side-section">
              <h2>像素取色</h2>
              <div className="export-options" role="group" aria-label="像素网格尺寸">
                {repixelizeSizes.map((size) => (
                  <button
                    key={size}
                    className={repixelizeSize === size ? "active" : ""}
                    onClick={() => handleRepixelize(size, repixelizePaletteSize)}
                    disabled={isRepixelizing}
                  >
                    {size}x{size}
                    <span>重新取样</span>
                  </button>
                ))}
              </div>
              <label className="repixelize-select">
                色数
                <select
                  value={repixelizePaletteSize}
                  disabled={isRepixelizing}
                  onChange={(event) => {
                    const nextPaletteSize = Number(event.target.value);
                    if (!isImportPaletteSize(nextPaletteSize)) return;
                    handleRepixelize(repixelizeSize, nextPaletteSize);
                  }}
                >
                  {repixelizePaletteSizes.map((size) => (
                    <option key={size} value={size}>
                      {size} 色
                    </option>
                  ))}
                </select>
              </label>
              <p className="repixelize-note">
                {isRepixelizing
                  ? "正在根据原图片重新像素化..."
                  : "基于原图片重新像素化，会替换当前像素，可撤回。"}
              </p>
            </section>
          ) : null}
          <section className="primary-side-section">
            <h2>导出设置</h2>
            <div className="export-options" role="group" aria-label="导出尺寸">
              <button
                className={exportScaleMode === "original" ? "active" : ""}
                onClick={() => setExportScaleMode("original")}
              >
                原始尺寸
                <span>{document.canvas.width}x{document.canvas.height}</span>
              </button>
              <button
                className={exportScaleMode === "preview" ? "active" : ""}
                onClick={() => setExportScaleMode("preview")}
              >
                预览大图
                <span>最长边约 512px</span>
              </button>
            </div>
            <div className="export-options" role="group" aria-label="导出背景">
              <button
                className={exportBackgroundMode === "transparent" ? "active" : ""}
                onClick={() => setExportBackgroundMode("transparent")}
              >
                透明背景
                <span>适合游戏素材</span>
              </button>
              <button
                className={exportBackgroundMode === "selected" ? "active" : ""}
                onClick={() => setExportBackgroundMode("selected")}
              >
                当前颜色背景
                <span>{selectedColor}</span>
              </button>
            </div>
            <PixelButton onClick={handleExportPng}>导出 PNG</PixelButton>
          </section>
          <section>
            <h2>图层</h2>
            <div className="layer-actions">
              <button onClick={handleRemoveBackground}>一键去背景</button>
              <button onClick={handleAddBackground}>增加背景色</button>
            </div>
            <div className="layer-list" aria-label="图层列表">
              {[...document.layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  className={`layer-row ${layer.id === document.activeLayerId ? "active" : ""}`}
                >
                  <button
                    className="layer-eye"
                    onClick={() => handleToggleLayerVisibility(layer.id)}
                    aria-label={`${layer.visible ? "隐藏" : "显示"}${layer.name}`}
                  >
                    {layer.visible ? "眼" : "关"}
                  </button>
                  <button
                    className="layer-main"
                    onClick={() => handleSelectLayer(layer.id)}
                    onDoubleClick={() => {
                      if (layer.name === "背景色") {
                        handleOpenBackgroundColorEditor();
                      }
                    }}
                    title={layer.name === "背景色" ? "双击编辑背景色" : undefined}
                  >
                    <span className="layer-thumb" />
                    <span>{layer.name}</span>
                  </button>
                  {layer.name === "背景色" && editingBackgroundColor ? (
                    <div className="background-color-panel">
                      <div className="background-color-panel-top">
                        <strong>背景色</strong>
                        <button
                          type="button"
                          onClick={() => setEditingBackgroundColor(null)}
                          aria-label="关闭背景色面板"
                        >
                          ×
                        </button>
                      </div>
                      <label>
                        颜色
                        <input
                          type="color"
                          value={editingBackgroundColor}
                          onChange={(event) => handleChangeBackgroundColor(event.target.value)}
                          aria-label="背景色颜色"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2>选区</h2>
            <div className="layer-actions">
              <button
                onClick={() => {
                  setSelectionInverted((current) => !current);
                  setStatus(selectionInverted ? "已恢复选区内可编辑" : "已反向选区，选区外可编辑");
                }}
                disabled={!selectionKeys.length}
              >
                反向选区
              </button>
              <button
                onClick={() => {
                  setSelectionKeys([]);
                  setSelectionInverted(false);
                  setSelectionMode(false);
                  setStatus("已清除选区，全部像素可编辑");
                }}
                disabled={!selectionKeys.length}
              >
                清除选区
              </button>
            </div>
            <p className="selection-note">
              {selectionKeys.length
                ? `${selectionInverted ? "选区外" : "选区内"}可编辑，共 ${selectionKeys.length} 个参考像素格。`
                : "点击左侧“智能选区”，再点画布中的对象。"}
            </p>
          </section>
          <section className="side-panel-muted">
            <h2>信息</h2>
            <p>来源：{sourceLabel}</p>
            <p>当前颜色：{selectedColor}</p>
            <p>当前图层：{activeLayer?.name ?? "默认图层"}</p>
            <p>动作 / 帧：{document.animations.length} / {document.frames.length}</p>
          </section>
        </aside>
      </section>

      <footer className="frame-strip">
        {document.frames.map((frame) => (
          <button
            key={frame.id}
            className={frame.id === document.activeFrameId ? "active" : ""}
            onClick={() =>
              setDocument({
                ...document,
                activeFrameId: frame.id
              })
            }
          >
            {frame.name}
          </button>
        ))}
      </footer>
    </main>
  );
}
