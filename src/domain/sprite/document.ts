import type {
  PixelMap,
  ProjectSummary,
  SpriteAnimation,
  SpriteDocument,
  SpriteFrame,
  SpriteLayer,
  SpriteSize
} from "./types";
import { renderDocumentThumbnail } from "./render";

const defaultPalette = [
  "#000000",
  "#ffffff",
  "#5a2ca0",
  "#7f4bea",
  "#ffe45c",
  "#ffb347",
  "#6de38f",
  "#58c7f3",
  "#eb5e7a",
  "#8a4f2d",
  "#2a183f",
  "#140927"
];

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function getNowIso() {
  return new Date().toISOString();
}

export function pixelKey(x: number, y: number) {
  return `${x},${y}`;
}

export function parsePixelKey(key: string) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function createSpriteDocument({
  name,
  size
}: {
  name: string;
  size: SpriteSize;
}): SpriteDocument {
  const now = getNowIso();
  const layer: SpriteLayer = {
    id: createId("layer"),
    name: "默认图层",
    visible: true,
    locked: false,
    opacity: 1
  };
  const frame: SpriteFrame = {
    id: createId("frame"),
    name: "第 1 帧",
    durationMs: 120,
    layerPixels: {
      [layer.id]: {}
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
    name,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    canvas: {
      width: size,
      height: size,
      background: "transparent"
    },
    palette: defaultPalette,
    layers: [layer],
    frames: [frame],
    animations: [animation],
    activeAnimationId: animation.id,
    activeFrameId: frame.id,
    activeLayerId: layer.id,
    sources: [
      {
        id: createId("source"),
        type: "blank",
        label: "空白项目",
        createdAt: now
      }
    ]
  };
}

export function getActiveFrame(document: SpriteDocument) {
  return (
    document.frames.find((frame) => frame.id === document.activeFrameId) ??
    document.frames[0]
  );
}

export function getActiveLayer(document: SpriteDocument) {
  return (
    document.layers.find((layer) => layer.id === document.activeLayerId) ??
    document.layers[0]
  );
}

export function getPixelMap(document: SpriteDocument) {
  const frame = getActiveFrame(document);
  const layer = getActiveLayer(document);
  return frame.layerPixels[layer.id] ?? {};
}

export function updatePixel(
  document: SpriteDocument,
  x: number,
  y: number,
  color: string | null
): SpriteDocument {
  const frame = getActiveFrame(document);
  const layer = getActiveLayer(document);
  const pixels = { ...(frame.layerPixels[layer.id] ?? {}) };
  const key = pixelKey(x, y);

  if (color) {
    pixels[key] = color;
  } else {
    delete pixels[key];
  }

  return {
    ...document,
    updatedAt: getNowIso(),
    frames: document.frames.map((item) =>
      item.id === frame.id
        ? {
            ...item,
            layerPixels: {
              ...item.layerPixels,
              [layer.id]: pixels
            }
          }
        : item
    )
  };
}

export function updatePixels(
  document: SpriteDocument,
  changes: Array<{ x: number; y: number; color: string | null }>
): SpriteDocument {
  const frame = getActiveFrame(document);
  const layer = getActiveLayer(document);
  const pixels = { ...(frame.layerPixels[layer.id] ?? {}) };

  changes.forEach(({ x, y, color }) => {
    const key = pixelKey(x, y);
    if (color) {
      pixels[key] = color;
    } else {
      delete pixels[key];
    }
  });

  return {
    ...document,
    updatedAt: getNowIso(),
    frames: document.frames.map((item) =>
      item.id === frame.id
        ? {
            ...item,
            layerPixels: {
              ...item.layerPixels,
              [layer.id]: pixels
            }
          }
        : item
    )
  };
}

export function setActiveLayer(document: SpriteDocument, layerId: string): SpriteDocument {
  if (!document.layers.some((layer) => layer.id === layerId)) {
    return document;
  }

  return {
    ...document,
    activeLayerId: layerId,
    updatedAt: getNowIso()
  };
}

export function toggleLayerVisibility(
  document: SpriteDocument,
  layerId: string
): SpriteDocument {
  return {
    ...document,
    updatedAt: getNowIso(),
    layers: document.layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            visible: !layer.visible
          }
        : layer
    )
  };
}

export function addOrUpdateBackgroundLayer(
  document: SpriteDocument,
  color: string
): SpriteDocument {
  const now = getNowIso();
  const existingLayer = document.layers.find((layer) => layer.name === "背景色");
  const backgroundLayer: SpriteLayer =
    existingLayer ??
    {
      id: createId("layer"),
      name: "背景色",
      visible: true,
      locked: false,
      opacity: 1
    };
  const pixels: PixelMap = {};

  for (let y = 0; y < document.canvas.height; y += 1) {
    for (let x = 0; x < document.canvas.width; x += 1) {
      pixels[pixelKey(x, y)] = color;
    }
  }

  return {
    ...document,
    updatedAt: now,
    layers: existingLayer
      ? document.layers.map((layer) =>
          layer.id === existingLayer.id ? backgroundLayer : layer
        )
      : [backgroundLayer, ...document.layers],
    frames: document.frames.map((frame) => ({
      ...frame,
      layerPixels: {
        ...frame.layerPixels,
        [backgroundLayer.id]: pixels
      }
    })),
    activeLayerId: existingLayer ? document.activeLayerId : document.activeLayerId
  };
}

function getMostFrequentCornerColor(document: SpriteDocument) {
  const pixels = getPixelMap(document);
  const maxX = document.canvas.width - 1;
  const maxY = document.canvas.height - 1;
  const counts = new Map<string, number>();

  [
    pixels[pixelKey(0, 0)],
    pixels[pixelKey(maxX, 0)],
    pixels[pixelKey(0, maxY)],
    pixels[pixelKey(maxX, maxY)]
  ].forEach((color) => {
    if (!color) return;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  });

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function removeDetectedBackgroundColor(document: SpriteDocument): {
  document: SpriteDocument;
  removedColor: string | null;
  removedCount: number;
} {
  const removedColor = getMostFrequentCornerColor(document);
  if (!removedColor) {
    return {
      document,
      removedColor: null,
      removedCount: 0
    };
  }

  const activeFrame = getActiveFrame(document);
  const activeLayer = getActiveLayer(document);
  const pixels = { ...(activeFrame.layerPixels[activeLayer.id] ?? {}) };
  let removedCount = 0;

  Object.entries(pixels).forEach(([key, color]) => {
    if (color.toLowerCase() !== removedColor.toLowerCase()) return;
    delete pixels[key];
    removedCount += 1;
  });

  return {
    document: {
      ...document,
      updatedAt: getNowIso(),
      frames: document.frames.map((frame) =>
        frame.id === activeFrame.id
          ? {
              ...frame,
              layerPixels: {
                ...frame.layerPixels,
                [activeLayer.id]: pixels
              }
            }
          : frame
      )
    },
    removedColor,
    removedCount
  };
}

function getColorDistance(color: string, target: string) {
  const r = parseInt(color.slice(1, 3), 16) - parseInt(target.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16) - parseInt(target.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16) - parseInt(target.slice(5, 7), 16);
  return r * r + g * g + b * b;
}

export function createSmartSelection(
  document: SpriteDocument,
  seedX: number,
  seedY: number
) {
  const pixels = getPixelMap(document);
  const seedKey = pixelKey(seedX, seedY);
  const seedColor = pixels[seedKey];
  if (!seedColor) return [];

  const backgroundColor = getMostFrequentCornerColor(document);
  const backgroundThreshold = 38 * 38;
  const similarColorThreshold = 34 * 34;
  const shouldUseBackgroundCutout =
    Boolean(backgroundColor) &&
    getColorDistance(seedColor, backgroundColor as string) > backgroundThreshold;
  const isSelectablePixel = (color: string | undefined) => {
    if (!color) return false;
    if (shouldUseBackgroundCutout && backgroundColor) {
      return getColorDistance(color, backgroundColor) > backgroundThreshold;
    }
    return getColorDistance(color, seedColor) <= similarColorThreshold;
  };
  const selected = new Set<string>();
  const queue = [{ x: seedX, y: seedY }];

  while (queue.length) {
    const point = queue.shift();
    if (!point) break;
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= document.canvas.width ||
      point.y >= document.canvas.height
    ) {
      continue;
    }

    const key = pixelKey(point.x, point.y);
    if (selected.has(key) || !isSelectablePixel(pixels[key])) continue;

    selected.add(key);
    queue.push(
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 }
    );
  }

  return Array.from(selected);
}

export function renameDocument(document: SpriteDocument, name: string): SpriteDocument {
  return {
    ...document,
    name: name.trim() || document.name,
    updatedAt: getNowIso()
  };
}

export function createSummary(document: SpriteDocument): ProjectSummary {
  return {
    id: document.id,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    canvasWidth: document.canvas.width,
    canvasHeight: document.canvas.height,
    animationCount: document.animations.length,
    frameCount: document.frames.length,
    thumbnail: renderDocumentThumbnail(document, 160),
    status: "saved"
  };
}
