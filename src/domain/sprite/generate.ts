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

export type PixelGenerationStyle =
  | "rpg-character"
  | "cute-pet"
  | "item-icon"
  | "avatar";

export interface PixelGenerationRequest {
  prompt: string;
  size: SpriteSize;
  style: PixelGenerationStyle;
}

export interface PixelGenerationCandidate {
  id: string;
  title: string;
  description: string;
  document: SpriteDocument;
}

const stylePresets: Record<
  PixelGenerationStyle,
  {
    label: string;
    sourceLabel: string;
    palette: string[];
    shape: "humanoid" | "pet" | "item" | "avatar";
  }
> = {
  "rpg-character": {
    label: "RPG 角色",
    sourceLabel: "文字生成占位：RPG 角色",
    palette: ["#1f2937", "#374151", "#f8c98c", "#7c3aed", "#facc15", "#111827"],
    shape: "humanoid"
  },
  "cute-pet": {
    label: "可爱宠物",
    sourceLabel: "文字生成占位：可爱宠物",
    palette: ["#3f2a1d", "#f5c451", "#f59e0b", "#fff1b8", "#7c2d12", "#111827"],
    shape: "pet"
  },
  "item-icon": {
    label: "道具图标",
    sourceLabel: "文字生成占位：道具图标",
    palette: ["#111827", "#4b5563", "#38bdf8", "#f8fafc", "#f59e0b", "#0f172a"],
    shape: "item"
  },
  avatar: {
    label: "头像",
    sourceLabel: "文字生成占位：头像",
    palette: ["#111827", "#f1c27d", "#8b5cf6", "#f97316", "#f8fafc", "#312e81"],
    shape: "avatar"
  }
};

function hashText(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function setPixel(pixels: PixelMap, size: SpriteSize, x: number, y: number, color: string) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  pixels[pixelKey(x, y)] = color;
}

function fillRect(
  pixels: PixelMap,
  size: SpriteSize,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) {
  for (let nextY = y; nextY < y + height; nextY += 1) {
    for (let nextX = x; nextX < x + width; nextX += 1) {
      setPixel(pixels, size, nextX, nextY, color);
    }
  }
}

function fillEllipse(
  pixels: PixelMap,
  size: SpriteSize,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: string
) {
  for (let y = Math.floor(centerY - radiusY); y <= Math.ceil(centerY + radiusY); y += 1) {
    for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
        setPixel(pixels, size, x, y, color);
      }
    }
  }
}

function mirrorPixel(pixels: PixelMap, size: SpriteSize, x: number, y: number, color: string) {
  setPixel(pixels, size, x, y, color);
  setPixel(pixels, size, size - 1 - x, y, color);
}

function addNoise(
  pixels: PixelMap,
  size: SpriteSize,
  random: () => number,
  palette: string[],
  amount: number
) {
  for (let index = 0; index < amount; index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const key = pixelKey(x, y);
    if (!pixels[key]) continue;
    pixels[key] = palette[2 + Math.floor(random() * Math.max(1, palette.length - 2))];
  }
}

function createHumanoidPixels(size: SpriteSize, palette: string[], random: () => number) {
  const pixels: PixelMap = {};
  const unit = Math.max(1, Math.round(size / 16));
  const center = Math.floor(size / 2);

  fillEllipse(pixels, size, center, unit * 4, unit * 3, unit * 3, palette[2]);
  fillRect(pixels, size, center - unit * 3, unit * 7, unit * 6, unit * 5, palette[3]);
  fillRect(pixels, size, center - unit * 5, unit * 8, unit * 2, unit * 4, palette[3]);
  fillRect(pixels, size, center + unit * 3, unit * 8, unit * 2, unit * 4, palette[3]);
  fillRect(pixels, size, center - unit * 3, unit * 12, unit * 2, unit * 3, palette[0]);
  fillRect(pixels, size, center + unit, unit * 12, unit * 2, unit * 3, palette[0]);
  fillRect(pixels, size, center - unit * 3, unit * 2, unit * 6, unit, palette[0]);
  mirrorPixel(pixels, size, center - unit, unit * 4, palette[5]);
  fillRect(pixels, size, center - unit, unit * 6, unit * 2, unit, palette[4]);
  addNoise(pixels, size, random, palette, unit * 3);
  return pixels;
}

function createPetPixels(size: SpriteSize, palette: string[], random: () => number) {
  const pixels: PixelMap = {};
  const unit = Math.max(1, Math.round(size / 16));
  const center = Math.floor(size / 2);

  fillEllipse(pixels, size, center - unit, unit * 9, unit * 5, unit * 3, palette[1]);
  fillEllipse(pixels, size, center + unit * 4, unit * 7, unit * 3, unit * 3, palette[1]);
  fillRect(pixels, size, center - unit * 5, unit * 11, unit * 2, unit * 3, palette[2]);
  fillRect(pixels, size, center, unit * 11, unit * 2, unit * 3, palette[2]);
  fillRect(pixels, size, center + unit * 6, unit * 5, unit, unit * 2, palette[2]);
  fillRect(pixels, size, center + unit * 2, unit * 4, unit * 2, unit * 2, palette[3]);
  fillRect(pixels, size, center + unit * 5, unit * 4, unit * 2, unit * 2, palette[3]);
  mirrorPixel(pixels, size, center + unit * 3, unit * 7, palette[5]);
  fillRect(pixels, size, center + unit * 5, unit * 8, unit * 2, unit, palette[4]);
  fillEllipse(pixels, size, center - unit * 7, unit * 8, unit * 2, unit * 3, palette[2]);
  addNoise(pixels, size, random, palette, unit * 4);
  return pixels;
}

function createItemPixels(size: SpriteSize, palette: string[], random: () => number) {
  const pixels: PixelMap = {};
  const unit = Math.max(1, Math.round(size / 16));
  const center = Math.floor(size / 2);

  fillEllipse(pixels, size, center, center, unit * 5, unit * 5, palette[2]);
  fillEllipse(pixels, size, center, center, unit * 3, unit * 3, palette[3]);
  fillRect(pixels, size, center - unit, unit * 3, unit * 2, unit * 10, palette[4]);
  fillRect(pixels, size, unit * 3, center - unit, unit * 10, unit * 2, palette[4]);
  fillRect(pixels, size, center - unit * 4, center - unit * 4, unit * 8, unit, palette[1]);
  fillRect(pixels, size, center - unit * 4, center + unit * 3, unit * 8, unit, palette[0]);
  addNoise(pixels, size, random, palette, unit * 2);
  return pixels;
}

function createAvatarPixels(size: SpriteSize, palette: string[], random: () => number) {
  const pixels: PixelMap = {};
  const unit = Math.max(1, Math.round(size / 16));
  const center = Math.floor(size / 2);

  fillEllipse(pixels, size, center, center - unit, unit * 5, unit * 6, palette[1]);
  fillRect(pixels, size, center - unit * 5, unit * 2, unit * 10, unit * 3, palette[0]);
  fillRect(pixels, size, center - unit * 6, unit * 5, unit * 2, unit * 4, palette[0]);
  fillRect(pixels, size, center + unit * 4, unit * 5, unit * 2, unit * 4, palette[0]);
  mirrorPixel(pixels, size, center - unit * 2, center - unit, palette[5]);
  fillRect(pixels, size, center - unit, center + unit * 2, unit * 2, unit, palette[3]);
  fillRect(pixels, size, center - unit * 5, center + unit * 5, unit * 10, unit * 3, palette[2]);
  addNoise(pixels, size, random, palette, unit * 3);
  return pixels;
}

function createPixels(
  size: SpriteSize,
  preset: (typeof stylePresets)[PixelGenerationStyle],
  random: () => number
) {
  if (preset.shape === "pet") return createPetPixels(size, preset.palette, random);
  if (preset.shape === "item") return createItemPixels(size, preset.palette, random);
  if (preset.shape === "avatar") return createAvatarPixels(size, preset.palette, random);
  return createHumanoidPixels(size, preset.palette, random);
}

export function generatePixelCandidates(
  request: PixelGenerationRequest
): PixelGenerationCandidate[] {
  const prompt = request.prompt.trim() || "未命名像素图";
  const preset = stylePresets[request.style];
  const now = getNowIso();

  return Array.from({ length: 4 }, (_, index) => {
    const seed = hashText(`${prompt}-${request.size}-${request.style}-${index}`);
    const random = createSeededRandom(seed);
    const layer: SpriteLayer = {
      id: createId("layer"),
      name: "生成图层",
      visible: true,
      locked: false,
      opacity: 1
    };
    const frame: SpriteFrame = {
      id: createId("frame"),
      name: "第 1 帧",
      durationMs: 120,
      layerPixels: {
        [layer.id]: createPixels(request.size, preset, random)
      }
    };
    const animation: SpriteAnimation = {
      id: createId("anim"),
      name: "idle",
      frameIds: [frame.id],
      fps: 8,
      loop: true
    };
    const document: SpriteDocument = {
      id: createId("sprite"),
      name: `${prompt.slice(0, 18)} ${index + 1}`,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      canvas: {
        width: request.size,
        height: request.size,
        background: "transparent"
      },
      palette: preset.palette,
      layers: [layer],
      frames: [frame],
      animations: [animation],
      activeAnimationId: animation.id,
      activeFrameId: frame.id,
      activeLayerId: layer.id,
      sources: [
        {
          id: createId("source"),
          type: "ai-placeholder",
          label: `${preset.sourceLabel}：${prompt}`,
          createdAt: now
        }
      ]
    };

    return {
      id: document.id,
      title: `${preset.label} 方案 ${index + 1}`,
      description: `${request.size}x${request.size} · 可进入编辑器继续修色`,
      document
    };
  });
}
