import type { ImportPaletteSize } from "@/domain/sprite/importPng";
import type { SpriteDocument, SpriteSize } from "@/domain/sprite/types";

export type WorkspaceItemType = "pixel-image";

export interface WorkspaceViewport {
  x: number;
  y: number;
  scale: number;
}

export interface WorkspaceItemPixelSettings {
  gridSize: SpriteSize;
  paletteSize: ImportPaletteSize;
}

export interface WorkspaceItemSource {
  fileName?: string;
  dataUrl?: string;
  mimeType?: string;
}

export interface WorkspaceItem {
  id: string;
  type: WorkspaceItemType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  pixelSettings: WorkspaceItemPixelSettings;
  source: WorkspaceItemSource;
  spriteDocument: SpriteDocument;
}

export interface CanvasWorkspace {
  id: string;
  name: string;
  schemaVersion: 1 | 2;
  createdAt: string;
  updatedAt: string;
  viewport: WorkspaceViewport;
  items: WorkspaceItem[];
  selectedItemIds: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  thumbnail: string;
}
