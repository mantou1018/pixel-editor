import type { PixelMap, SpriteDocument } from "./types";
import { parsePixelKey } from "./document";

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number
) {
  const checker = Math.max(4, Math.floor(cellSize / 2));
  for (let y = 0; y < height; y += checker) {
    for (let x = 0; x < width; x += checker) {
      ctx.fillStyle = (Math.floor(x / checker) + Math.floor(y / checker)) % 2
        ? "#111014"
        : "#1d1a22";
      ctx.fillRect(x, y, checker, checker);
    }
  }
}

export function drawPixels(
  ctx: CanvasRenderingContext2D,
  pixels: PixelMap,
  cellSize: number
) {
  Object.entries(pixels).forEach(([key, color]) => {
    const { x, y } = parsePixelKey(key);
    ctx.fillStyle = color;
    ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
  });
}

export function renderDocumentToCanvas(
  canvas: HTMLCanvasElement,
  document: SpriteDocument,
  options?: {
    showCheckerboard?: boolean;
    showGrid?: boolean;
    selected?: { x: number; y: number } | null;
    selectedSize?: number;
    scale?: number;
  }
) {
  const scale = options?.scale ?? 12;
  const width = document.canvas.width * scale;
  const height = document.canvas.height * scale;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  if (options?.showCheckerboard ?? true) {
    drawCheckerboard(ctx, width, height, scale);
  }

  const activeFrame =
    document.frames.find((frame) => frame.id === document.activeFrameId) ??
    document.frames[0];

  document.layers
    .filter((layer) => layer.visible)
    .forEach((layer) => {
      drawPixels(ctx, activeFrame?.layerPixels[layer.id] ?? {}, scale);
    });

  if (options?.showGrid) {
    ctx.strokeStyle = "rgba(126, 82, 231, 0.28)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= document.canvas.width; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * scale + 0.5, 0);
      ctx.lineTo(x * scale + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= document.canvas.height; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale + 0.5);
      ctx.lineTo(width, y * scale + 0.5);
      ctx.stroke();
    }
  }

  if (options?.selected) {
    const selectedSize = Math.max(1, options.selectedSize ?? 1);
    const offset = Math.floor(selectedSize / 2);
    const startX = Math.max(0, options.selected.x - offset);
    const startY = Math.max(0, options.selected.y - offset);
    const endX = Math.min(document.canvas.width, startX + selectedSize);
    const endY = Math.min(document.canvas.height, startY + selectedSize);

    ctx.strokeStyle = "#ffe45c";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      startX * scale + 1,
      startY * scale + 1,
      (endX - startX) * scale - 2,
      (endY - startY) * scale - 2
    );
  }
}

export function renderDocumentThumbnail(
  document: SpriteDocument,
  size = 160
): string {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return "";
  }

  const canvas = window.document.createElement("canvas");
  const cellSize = Math.max(
    1,
    Math.floor(size / Math.max(document.canvas.width, document.canvas.height))
  );
  renderDocumentToCanvas(canvas, document, {
    showGrid: false,
    scale: cellSize
  });
  return canvas.toDataURL("image/png");
}

export function exportDocumentPng(document: SpriteDocument): string {
  const canvas = window.document.createElement("canvas");
  const scale = Math.max(4, Math.floor(512 / document.canvas.width));
  renderDocumentToCanvas(canvas, document, {
    showCheckerboard: false,
    showGrid: false,
    scale
  });
  return canvas.toDataURL("image/png");
}
