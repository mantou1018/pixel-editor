"use client";

import { useEffect, useRef, useState } from "react";
import type { SpriteDocument } from "@/domain/sprite/types";
import { renderDocumentToCanvas } from "@/domain/sprite/render";

const minCanvasScale = 4;
const maxCanvasScale = 40;

interface SpriteCanvasProps {
  document: SpriteDocument;
  selectedColor: string;
  eraseMode: boolean;
  brushSize: number;
  onPixelChange: (x: number, y: number, color: string | null) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

export function SpriteCanvas({
  document,
  selectedColor,
  eraseMode,
  brushSize,
  onPixelChange,
  onStrokeStart,
  onStrokeEnd
}: SpriteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPixelRef = useRef<string | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const defaultScale = document.canvas.width <= 16 ? 28 : document.canvas.width <= 32 ? 18 : 10;
  const [canvasScale, setCanvasScale] = useState(defaultScale);

  useEffect(() => {
    setCanvasScale(defaultScale);
  }, [defaultScale, document.id]);

  useEffect(() => {
    if (!canvasRef.current) return;
    renderDocumentToCanvas(canvasRef.current, document, {
      showGrid: true,
      selected,
      selectedSize: brushSize,
      scale: canvasScale
    });
  }, [document, selected, brushSize, canvasScale]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      setCanvasScale((current) => {
        const direction = event.deltaY < 0 ? 1 : -1;
        const step = current >= 20 ? 2 : 1;
        return Math.min(maxCanvasScale, Math.max(minCanvasScale, current + direction * step));
      });
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
        {selected ? ` · 选中 ${selected.x},${selected.y}` : ""}
      </div>
    </div>
  );
}
