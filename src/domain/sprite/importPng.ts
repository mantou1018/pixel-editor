import {
  createId,
  getNowIso,
  pixelKey
} from "./document";
import type {
  PixelMap,
  SpriteAnimation,
  SpriteDocument,
  SpriteFrame,
  SpriteLayer,
  SpriteSize
} from "./types";

type DecodedImage = HTMLImageElement | ImageBitmap;
export type ImportPaletteSize = 8 | 16 | 32 | 64 | 128 | 256 | 512;

export interface PngImportOptions {
  paletteSize?: ImportPaletteSize;
}

const fallbackPalette = [
  "#000000",
  "#ffffff",
  "#5a2ca0",
  "#7f4bea",
  "#ffe45c",
  "#ffb347",
  "#6de38f",
  "#58c7f3"
];

const alphaCutoff = 32;
const maxPaletteColors = 512;
const defaultPaletteSize: ImportPaletteSize = 32;

function isPngFile(file: File) {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

function stripPngExtension(fileName: string) {
  return fileName.replace(/\.png$/i, "").trim() || "PNG 导入精灵图";
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function toColor(r: number, g: number, b: number) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseColor(color: string) {
  return {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16)
  };
}

function getImageSize(image: DecodedImage) {
  if (image instanceof HTMLImageElement) {
    return {
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  }

  return {
    width: image.width,
    height: image.height
  };
}

function getContainedDrawBox(width: number, height: number, size: SpriteSize) {
  const scale = Math.min(size / width, size / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));

  return {
    drawWidth,
    drawHeight,
    drawX: Math.floor((size - drawWidth) / 2),
    drawY: Math.floor((size - drawHeight) / 2)
  };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("PNG 图片读取失败"));
    };
    image.src = url;
  });
}

function drawImageIntoGrid(
  image: DecodedImage,
  size: SpriteSize
): ImageData {
  const { width, height } = getImageSize(image);
  const sourceCanvas = window.document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;

  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    throw new Error("当前浏览器不支持图片导入画布");
  }

  sourceCtx.clearRect(0, 0, width, height);
  sourceCtx.drawImage(image, 0, 0, width, height);

  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const gridData = new ImageData(size, size);
  const { drawWidth, drawHeight, drawX, drawY } = getContainedDrawBox(
    width,
    height,
    size
  );

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (
        x < drawX ||
        y < drawY ||
        x >= drawX + drawWidth ||
        y >= drawY + drawHeight
      ) {
        continue;
      }

      const sourceLeft = ((x - drawX) / drawWidth) * width;
      const sourceTop = ((y - drawY) / drawHeight) * height;
      const sourceRight = ((x + 1 - drawX) / drawWidth) * width;
      const sourceBottom = ((y + 1 - drawY) / drawHeight) * height;
      const targetIndex = (y * size + x) * 4;
      const average = sampleAverageColor(
        sourceData,
        sourceLeft,
        sourceTop,
        sourceRight,
        sourceBottom
      );

      gridData.data[targetIndex] = average.r;
      gridData.data[targetIndex + 1] = average.g;
      gridData.data[targetIndex + 2] = average.b;
      gridData.data[targetIndex + 3] = average.a;
    }
  }

  return gridData;
}

function sampleAverageColor(
  imageData: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const startX = Math.max(0, Math.floor(left));
  const startY = Math.max(0, Math.floor(top));
  const endX = Math.min(imageData.width, Math.ceil(right));
  const endY = Math.min(imageData.height, Math.ceil(bottom));
  let totalArea = 0;
  let alphaArea = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (let y = startY; y < endY; y += 1) {
    const overlapY = Math.min(bottom, y + 1) - Math.max(top, y);
    if (overlapY <= 0) continue;

    for (let x = startX; x < endX; x += 1) {
      const overlapX = Math.min(right, x + 1) - Math.max(left, x);
      if (overlapX <= 0) continue;

      const area = overlapX * overlapY;
      const index = (y * imageData.width + x) * 4;
      const alpha = imageData.data[index + 3] / 255;
      const weightedArea = area * alpha;

      totalArea += area;
      alphaArea += weightedArea;
      r += imageData.data[index] * weightedArea;
      g += imageData.data[index + 1] * weightedArea;
      b += imageData.data[index + 2] * weightedArea;
    }
  }

  const averageAlpha = totalArea ? Math.round((alphaArea / totalArea) * 255) : 0;
  if (!alphaArea || averageAlpha < alphaCutoff) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: Math.round(r / alphaArea),
    g: Math.round(g / alphaArea),
    b: Math.round(b / alphaArea),
    a: averageAlpha
  };
}

function colorDistance(color: string, target: string) {
  const a = parseColor(color);
  const b = parseColor(target);
  const r = a.r - b.r;
  const g = a.g - b.g;
  const blue = a.b - b.b;
  return r * r + g * g + blue * blue;
}

function findNearestColor(color: string, palette: string[]) {
  return palette.reduce(
    (nearest, candidate) => {
      const distance = colorDistance(color, candidate);
      return distance < nearest.distance ? { color: candidate, distance } : nearest;
    },
    { color: palette[0] ?? color, distance: Number.POSITIVE_INFINITY }
  ).color;
}

function pixelsFromImageData(
  imageData: ImageData,
  size: SpriteSize,
  options?: PngImportOptions
) {
  const rawPixels: PixelMap = {};
  const colorCounts = new Map<string, number>();
  const paletteSize = Math.min(
    maxPaletteColors,
    options?.paletteSize ?? defaultPaletteSize
  );

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const alpha = imageData.data[index + 3];
      if (alpha < alphaCutoff) continue;

      const color = toColor(
        imageData.data[index],
        imageData.data[index + 1],
        imageData.data[index + 2]
      );
      rawPixels[pixelKey(x, y)] = color;
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
    }
  }

  const palette = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)
    .slice(0, paletteSize);
  const activePalette = palette.length ? palette : fallbackPalette;
  const pixels = Object.fromEntries(
    Object.entries(rawPixels).map(([key, color]) => [
      key,
      findNearestColor(color, activePalette)
    ])
  );

  return {
    pixels,
    palette: activePalette
  };
}

export async function createSpriteDocumentFromPng(
  file: File,
  size: SpriteSize,
  options?: PngImportOptions
): Promise<SpriteDocument> {
  if (!isPngFile(file)) {
    throw new Error("目前只支持导入 PNG 图片");
  }

  const image = await decodeImage(file);

  try {
    const now = getNowIso();
    const layer: SpriteLayer = {
      id: createId("layer"),
      name: "PNG 导入图层",
      visible: true,
      locked: false,
      opacity: 1
    };
    const { pixels, palette } = pixelsFromImageData(
      drawImageIntoGrid(image, size),
      size,
      options
    );
    const frame: SpriteFrame = {
      id: createId("frame"),
      name: "第 1 帧",
      durationMs: 120,
      layerPixels: {
        [layer.id]: pixels
      }
    };
    const animation: SpriteAnimation = {
      id: createId("anim"),
      name: "idle",
      frameIds: [frame.id],
      fps: 8,
      loop: true
    };

    return {
      id: createId("sprite"),
      name: stripPngExtension(file.name),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      canvas: {
        width: size,
        height: size,
        background: "transparent"
      },
      palette,
      layers: [layer],
      frames: [frame],
      animations: [animation],
      activeAnimationId: animation.id,
      activeFrameId: frame.id,
      activeLayerId: layer.id,
      sources: [
        {
          id: createId("source"),
          type: "pixel-import",
          label: `PNG 导入：${file.name}，${palette.length} 色`,
          createdAt: now
        }
      ]
    };
  } finally {
    if ("close" in image && typeof image.close === "function") {
      image.close();
    }
  }
}
