"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpriteDocument } from "@/domain/sprite/types";
import { renderDocumentToCanvas } from "@/domain/sprite/render";

const minCanvasScale = 4;
const maxCanvasScale = 40;
type CanvasScaleMode = "fit" | "manual";

interface SpriteCanvasProps {
  document: SpriteDocument;
  selectedColor: string;
  eraseMode: boolean;
  brushSize: number;
  selectionMode: boolean;
  editableMask: Set<string> | null;
  selectionInverted: boolean;
  onPixelChange: (x: number, y: number, color: string | null) => void;
  onSmartSelect: (x: number, y: number) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

export function SpriteCanvas({
  document,
  selectedColor,
  eraseMode,
  brushSize,
  selectionMode,
  editableMask,
  selectionInverted,
  onPixelChange,
  onSmartSelect,
  onStrokeStart,
  onStrokeEnd
}: SpriteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPixelRef = useRef<string | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [canvasScale, setCanvasScale] = useState(minCanvasScale);
  const [canvasScaleMode, setCanvasScaleMode] = useState<CanvasScaleMode>("fit");
  const [showGrid, setShowGrid] = useState(true);
  const canvasScaleModeRef = useRef<CanvasScaleMode>("fit");

  const getFitScale = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return minCanvasScale;

    const shellRect = shell.getBoundingClientRect();
    const visibleWidth = window.innerWidth - shellRect.left - 72;
    const visibleHeight = window.innerHeight - shellRect.top - 96;
    const availableWidth = Math.max(160, Math.min(shell.clientWidth - 72, visibleWidth));
    const availableHeight = Math.max(160, Math.min(shell.clientHeight - 112, visibleHeight));
    const scale = Math.floor(
      Math.min(
        availableWidth / document.canvas.width,
        availableHeight / document.canvas.height
      )
    );

    return Math.min(maxCanvasScale, Math.max(minCanvasScale, scale));
  }, [document.canvas.height, document.canvas.width]);

  const fitCanvasToShell = useCallback(() => {
    setCanvasScale(getFitScale());
  }, [getFitScale]);

  function updateCanvasScale(
    updater: number | ((current: number) => number),
    mode: CanvasScaleMode
  ) {
    canvasScaleModeRef.current = mode;
    setCanvasScaleMode(mode);
    setCanvasScale(updater);
  }

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    canvasScaleModeRef.current = "fit";
    setCanvasScaleMode("fit");

    const frame = window.requestAnimationFrame(fitCanvasToShell);
    const observer = new ResizeObserver(() => {
      if (canvasScaleModeRef.current === "fit") {
        fitCanvasToShell();
      }
    });
    observer.observe(shell);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [document.id, fitCanvasToShell]);

  useEffect(() => {
    if (!canvasRef.current) return;
    renderDocumentToCanvas(canvasRef.current, document, {
      showGrid,
      editableMask,
      selectionInverted,
      selected,
      selectedSize: brushSize,
      scale: canvasScale
    });
  }, [document, selected, brushSize, canvasScale, showGrid, editableMask, selectionInverted]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      updateCanvasScale((current) => {
        const direction = event.deltaY < 0 ? 1 : -1;
        const step = current >= 20 ? 2 : 1;
        return Math.min(maxCanvasScale, Math.max(minCanvasScale, current + direction * step));
      }, "manual");
    }

    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, []);

  function getPointerPixel(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * document.canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * document.canvas.height);
    if (x < 0 || y < 0 || x >= document.canvas.width || y >= document.canvas.height) {
      return null;
    }
    return { x, y };
  }

  function paintPixel(pixel: { x: number; y: number }) {
    const key = `${pixel.x},${pixel.y}`;
    if (lastPixelRef.current === key) return;
    if (editableMask?.size) {
      const isSelected = editableMask.has(key);
      const isEditable = selectionInverted ? !isSelected : isSelected;
      if (!isEditable) return;
    }

    lastPixelRef.current = key;
    setSelected(pixel);
    onPixelChange(pixel.x, pixel.y, eraseMode ? null : selectedColor);
  }

  function paintLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

    for (let step = 1; step <= steps; step += 1) {
      paintPixel({
        x: Math.round(from.x + (dx * step) / steps),
        y: Math.round(from.y + (dy * step) / steps)
      });
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const pixel = getPointerPixel(event);
    if (!pixel) return;

    if (selectionMode) {
      setSelected(pixel);
      onSmartSelect(pixel.x, pixel.y);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    lastPixelRef.current = null;
    lastPointRef.current = pixel;
    onStrokeStart();
    paintPixel(pixel);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const pixel = getPointerPixel(event);
    if (!pixel) return;

    if (lastPointRef.current) {
      paintLine(lastPointRef.current, pixel);
    } else {
      paintPixel(pixel);
    }
    lastPointRef.current = pixel;
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    isDrawingRef.current = false;
    lastPixelRef.current = null;
    lastPointRef.current = null;
    onStrokeEnd();
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const pixel = getPointerPixel(event);
    if (pixel) return;

    lastPixelRef.current = null;
    lastPointRef.current = null;
  }

  return (
    <div ref={shellRef} className="canvas-shell">
      <div className="canvas-zoom-controls" aria-label="画布缩放控制">
        <button
          type="button"
          onClick={() => {
            updateCanvasScale(
              (current) => Math.max(minCanvasScale, current - 1),
              "manual"
            );
          }}
          aria-label="缩小画布"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => {
            canvasScaleModeRef.current = "fit";
            setCanvasScaleMode("fit");
            fitCanvasToShell();
          }}
        >
          适应
        </button>
        <button
          type="button"
          onClick={() => {
            updateCanvasScale(
              (current) => Math.min(maxCanvasScale, current + 1),
              "manual"
            );
          }}
          aria-label="放大画布"
        >
          +
        </button>
        <button
          type="button"
          className={showGrid ? "active" : ""}
          onClick={() => setShowGrid((current) => !current)}
          aria-pressed={showGrid}
        >
          参考线
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="sprite-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onPointerLeave={handlePointerLeave}
      />
      <div className="canvas-status">
        {document.canvas.width}x{document.canvas.height} · 缩放 {canvasScale}x
        {canvasScaleMode === "manual" ? " · 手动缩放" : " · 适应窗口"}
        {showGrid ? " · 参考线开" : " · 参考线关"}
        {editableMask?.size
          ? ` · 选区 ${selectionInverted ? "反向" : "内"} ${editableMask.size} 格`
          : ""}
        {selected ? ` · 选中 ${selected.x},${selected.y}` : ""}
      </div>
    </div>
  );
}
