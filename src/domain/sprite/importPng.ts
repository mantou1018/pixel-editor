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
  sourceDataUrl?: string;
}

interface WeightedColor {
  color: string;
  r: number;
  g: number;
  b: number;
  count: number;
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

function isSupportedImageFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp" ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp")
  );
}

function stripImageExtension(fileName: string) {
  return fileName.replace(/\.(png|jpe?g|webp)$/i, "").trim() || "图片导入像素图";
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
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片保存失败"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileFromDataUrl(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
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
  sourceCtx.imageSmoothingEnabled = false;
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
      const targetIndex = (y * size + x) * 4;
      const sampled = sampleNearestColor(
        sourceData,
        sourceLeft,
        sourceTop,
        ((x + 1 - drawX) / drawWidth) * width,
        ((y + 1 - drawY) / drawHeight) * height
      );

      gridData.data[targetIndex] = sampled.r;
      gridData.data[targetIndex + 1] = sampled.g;
      gridData.data[targetIndex + 2] = sampled.b;
      gridData.data[targetIndex + 3] = sampled.a;
    }
  }

  return gridData;
}

function sampleNearestColor(
  imageData: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const x = Math.min(
    imageData.width - 1,
    Math.max(0, Math.floor((left + right) / 2))
  );
  const y = Math.min(
    imageData.height - 1,
    Math.max(0, Math.floor((top + bottom) / 2))
  );
  const index = (y * imageData.width + x) * 4;
  const alpha = imageData.data[index + 3];

  if (alpha < alphaCutoff) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: imageData.data[index],
    g: imageData.data[index + 1],
    b: imageData.data[index + 2],
    a: alpha
  };
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

function toWeightedColors(colorCounts: Map<string, number>) {
  return Array.from(colorCounts.entries()).map(([color, count]) => ({
    color,
    ...parseColor(color),
    count
  }));
}

function getWeightedRepresentativeColor(colors: WeightedColor[]) {
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  colors.forEach((color) => {
    total += color.count;
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
  });

  if (!total) {
    return colors[0]?.color ?? fallbackPalette[0];
  }

  const average = {
    r: Math.round(r / total),
    g: Math.round(g / total),
    b: Math.round(b / total)
  };

  return colors.reduce(
    (nearest, color) => {
      const distance =
        (color.r - average.r) * (color.r - average.r) +
        (color.g - average.g) * (color.g - average.g) +
        (color.b - average.b) * (color.b - average.b);
      return distance < nearest.distance ? { color: color.color, distance } : nearest;
    },
    { color: colors[0]?.color ?? fallbackPalette[0], distance: Number.POSITIVE_INFINITY }
  ).color;
}

function getColorRange(colors: WeightedColor[], channel: "r" | "g" | "b") {
  return colors.reduce(
    (range, color) => ({
      min: Math.min(range.min, color[channel]),
      max: Math.max(range.max, color[channel])
    }),
    { min: 255, max: 0 }
  );
}

function getDominantRangeChannel(colors: WeightedColor[]) {
  const ranges = {
    r: getColorRange(colors, "r"),
    g: getColorRange(colors, "g"),
    b: getColorRange(colors, "b")
  };
  const channels: Array<"r" | "g" | "b"> = ["r", "g", "b"];

  return channels.reduce((largest, channel) => {
    const largestRange = ranges[largest].max - ranges[largest].min;
    const currentRange = ranges[channel].max - ranges[channel].min;
    return currentRange > largestRange ? channel : largest;
  }, "r");
}

function splitColorBucket(colors: WeightedColor[]) {
  if (colors.length <= 1) {
    return [colors, []];
  }

  const channel = getDominantRangeChannel(colors);
  const sorted = [...colors].sort((a, b) => a[channel] - b[channel]);
  const total = sorted.reduce((sum, color) => sum + color.count, 0);
  const midpoint = total / 2;
  let runningTotal = 0;
  let splitIndex = 1;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    runningTotal += sorted[index].count;
    if (runningTotal >= midpoint) {
      splitIndex = index + 1;
      break;
    }
  }

  return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)];
}

function selectPaletteColors(colorCounts: Map<string, number>, paletteSize: number) {
  const candidates = toWeightedColors(colorCounts);
  if (candidates.length <= paletteSize) {
    return candidates.map(({ color }) => color);
  }

  const buckets: WeightedColor[][] = [candidates];

  while (buckets.length < paletteSize) {
    const splitTargetIndex = buckets.reduce((bestIndex, bucket, index) => {
      if (bucket.length <= 1) return bestIndex;
      if (bestIndex === -1) return index;

      const bestChannel = getDominantRangeChannel(buckets[bestIndex]);
      const currentChannel = getDominantRangeChannel(bucket);
      const bestRange = getColorRange(buckets[bestIndex], bestChannel);
      const currentRange = getColorRange(bucket, currentChannel);
      const bestScore = (bestRange.max - bestRange.min) * buckets[bestIndex].length;
      const currentScore = (currentRange.max - currentRange.min) * bucket.length;

      return currentScore > bestScore ? index : bestIndex;
    }, -1);

    if (splitTargetIndex === -1) break;

    const [left, right] = splitColorBucket(buckets[splitTargetIndex]);
    buckets.splice(splitTargetIndex, 1, left, right);
  }

  return buckets
    .filter((bucket) => bucket.length)
    .map(getWeightedRepresentativeColor);
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

  const palette = selectPaletteColors(colorCounts, paletteSize);
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
  if (!isSupportedImageFile(file)) {
    throw new Error("目前只支持导入 PNG、JPG 或 WebP 图片");
  }

  const [image, sourceDataUrl] = await Promise.all([
    decodeImage(file),
    options?.sourceDataUrl ? Promise.resolve(options.sourceDataUrl) : fileToDataUrl(file)
  ]);

  try {
    const now = getNowIso();
    const paletteSize = Math.min(
      maxPaletteColors,
      options?.paletteSize ?? defaultPaletteSize
    );
    const layer: SpriteLayer = {
      id: createId("layer"),
      name: "图片导入图层",
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
      name: stripImageExtension(file.name),
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
          label: `图片导入：${file.name}，${palette.length} 色`,
          createdAt: now,
          originalPngDataUrl: sourceDataUrl,
          originalFileName: file.name,
          importPaletteSize: paletteSize,
          importGridSize: size
        }
      ]
    };
  } finally {
    if ("close" in image && typeof image.close === "function") {
      image.close();
    }
  }
}

export function getPngImportSource(document: SpriteDocument) {
  return [...document.sources]
    .reverse()
    .find((source) => source.originalPngDataUrl);
}

export async function repixelizeSpriteDocumentFromPng(
  document: SpriteDocument,
  size: SpriteSize,
  options?: PngImportOptions
): Promise<SpriteDocument> {
  const source = getPngImportSource(document);
  if (!source?.originalPngDataUrl) {
    throw new Error("这个项目没有保存原始图片，不能重新取色");
  }

  const fileName = source.originalFileName ?? `${document.name}.png`;
  const file = await fileFromDataUrl(source.originalPngDataUrl, fileName);
  const nextDocument = await createSpriteDocumentFromPng(file, size, {
    ...options,
    sourceDataUrl: source.originalPngDataUrl
  });
  const paletteSize = Math.min(
    maxPaletteColors,
    options?.paletteSize ?? defaultPaletteSize
  );
  const now = getNowIso();

  return {
    ...nextDocument,
    id: document.id,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: now,
    sources: [
      ...document.sources,
      {
        id: createId("source"),
        type: "photo-pixelize",
        label: `重新像素化：${fileName}，${size}x${size}，${paletteSize} 色`,
        createdAt: now,
        originalPngDataUrl: source.originalPngDataUrl,
        originalFileName: fileName,
        importPaletteSize: paletteSize,
        importGridSize: size
      }
    ]
  };
}
