export type SpriteSize = 16 | 32 | 64;

export type PixelMap = Record<string, string>;

export interface SpriteLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface SpriteFrame {
  id: string;
  name: string;
  durationMs: number;
  layerPixels: Record<string, PixelMap>;
}

export interface SpriteAnimation {
  id: string;
  name: string;
  frameIds: string[];
  fps: number;
  loop: boolean;
}

export interface SpriteCanvasMeta {
  width: SpriteSize;
  height: SpriteSize;
  background: "transparent" | string;
}

export interface SpriteSource {
  id: string;
  type: "blank" | "ai-placeholder" | "pixel-import" | "photo-pixelize";
  label: string;
  createdAt: string;
}

export interface SpriteDocument {
  id: string;
  name: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  canvas: SpriteCanvasMeta;
  palette: string[];
  layers: SpriteLayer[];
  frames: SpriteFrame[];
  animations: SpriteAnimation[];
  activeAnimationId: string;
  activeFrameId: string;
  activeLayerId: string;
  sources: SpriteSource[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvasWidth: SpriteSize;
  canvasHeight: SpriteSize;
  animationCount: number;
  frameCount: number;
  thumbnail: string;
  status: "draft" | "saved" | "error";
}
