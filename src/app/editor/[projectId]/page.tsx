"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PixelButton } from "@/components/PixelButton";
import { SpriteCanvas } from "@/components/editor/SpriteCanvas";
import {
  addOrUpdateBackgroundLayer,
  getPixelMap,
  pixelKey,
  removeDetectedBackgroundColor,
  setActiveLayer,
  toggleLayerVisibility,
  updatePixels
} from "@/domain/sprite/document";
import { exportDocumentPng } from "@/domain/sprite/render";
import type { SpriteDocument } from "@/domain/sprite/types";
import { downloadDataUrl, downloadText } from "@/lib/download";
import { loadProject, saveProject } from "@/lib/storage/projects";

const maxUndoSteps = 50;
type StrokeChange = { x: number; y: number; color: string | null };
type BrushPopoverTool = "brush" | "eraser" | null;
const minBrushSize = 1;
const maxBrushSize = 8;

export default function EditorPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [document, setDocument] = useState<SpriteDocument | null>(null);
  const [status, setStatus] = useState("读取项目...");
  const [selectedColor, setSelectedColor] = useState("#374151");
  const [eraseMode, setEraseMode] = useState(false);
  const [brushSize, setBrushSize] = useState(minBrushSize);
  const [brushPopoverTool, setBrushPopoverTool] = useState<BrushPopoverTool>(null);
  const [editingBackgroundColor, setEditingBackgroundColor] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<SpriteDocument[]>([]);
  const strokeStartDocumentRef = useRef<SpriteDocument | null>(null);
  const strokeChangesRef = useRef<StrokeChange[]>([]);

  useEffect(() => {
    async function load() {
      const loaded = await loadProject(projectId);
      if (!loaded) {
        setStatus("项目不存在或读取失败");
        return;
      }
      setDocument(loaded);
      setUndoStack([]);
      strokeStartDocumentRef.current = null;
      strokeChangesRef.current = [];
      setStatus("已读取，可继续编辑");
    }
    load();
  }, [projectId]);

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
    return document.sources[document.sources.length - 1]?.label ?? "未知来源";
  }, [document]);

  async function handleSave() {
    if (!document) return;
    setStatus("保存中...");
    const summary = await saveProject(document);
    setDocument((current) => (current ? { ...current, updatedAt: summary.updatedAt } : current));
    setStatus("已保存");
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
    downloadDataUrl(`${document.name}.png`, exportDocumentPng(document));
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
          <PixelButton onClick={handleSave}>保存</PixelButton>
          <PixelButton variant="secondary" onClick={handleExportJson}>
            导出 JSON
          </PixelButton>
          <PixelButton variant="secondary" onClick={handleExportPng}>
            导出 PNG
          </PixelButton>
        </div>
      </header>

      <section className="editor-shell">
        <aside className="tool-rail" aria-label="工具栏">
          <div className="tool-with-options">
            <button
              className={!eraseMode ? "active" : ""}
              onClick={() => {
                setEraseMode(false);
                setBrushPopoverTool(null);
              }}
            >
              画笔
            </button>
            <button
              className="tool-option-toggle"
              onClick={() => {
                setEraseMode(false);
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
                setBrushPopoverTool(null);
              }}
            >
              橡皮
            </button>
            <button
              className="tool-option-toggle"
              onClick={() => {
                setEraseMode(true);
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
          <label>
            颜色
            <input
              type="color"
              value={selectedColor}
              onChange={(event) => {
                setSelectedColor(event.target.value);
                setEraseMode(false);
              }}
            />
          </label>
        </aside>

        <SpriteCanvas
          document={document}
          selectedColor={selectedColor}
          eraseMode={eraseMode}
          brushSize={brushSize}
          onPixelChange={handlePixelChange}
          onStrokeStart={handleStrokeStart}
          onStrokeEnd={handleStrokeEnd}
        />

        <aside className="side-panel">
          <section>
            <h2>生成来源</h2>
            <p>{sourceLabel}</p>
            <button disabled>基于当前图再生成</button>
            <p>下一轮接真实 AI 或局部重绘；当前结果已可编辑和导出。</p>
          </section>
          <section>
            <h2>控制</h2>
            <p>当前颜色：{selectedColor}</p>
            <p>图层：{activeLayer?.name ?? "默认图层"}</p>
            <p>动作数：{document.animations.length}</p>
            <p>帧数：{document.frames.length} / 12</p>
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
