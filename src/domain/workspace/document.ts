import { createId, getNowIso } from "@/domain/sprite/document";
import type { ImportPaletteSize } from "@/domain/sprite/importPng";
import { renderDocumentThumbnail } from "@/domain/sprite/render";
import type { SpriteDocument, SpriteSize } from "@/domain/sprite/types";
import type {
  CanvasWorkspace,
  WorkspaceItem,
  WorkspaceItemSource,
  WorkspaceSummary
} from "./types";

const defaultViewport = {
  x: 0,
  y: 0,
  scale: 1
};

const workspacePixelDisplaySize = 8;
const defaultPaletteSize: ImportPaletteSize = 32;

export function getWorkspaceItemDisplaySize(pixelSize: number) {
  return pixelSize * workspacePixelDisplaySize;
}

export function normalizeWorkspaceItemDisplaySizes(
  workspace: CanvasWorkspace
): CanvasWorkspace {
  let hasChanges = false;
  const items = workspace.items.map((item) => {
    const displaySize = getWorkspaceItemDisplaySize(item.spriteDocument.canvas.width);
    if (item.width === displaySize && item.height === displaySize) return item;
    hasChanges = true;
    return { ...item, width: displaySize, height: displaySize };
  });

  return hasChanges ? { ...workspace, updatedAt: getNowIso(), items } : workspace;
}

export function createWorkspace(name = "新的像素画布"): CanvasWorkspace {
  const now = getNowIso();

  return {
    id: createId("workspace"),
    name,
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    viewport: defaultViewport,
    items: [],
    selectedItemIds: []
  };
}

export function createWorkspaceItemFromDocument({
  document,
  name,
  x,
  y,
  source,
  gridSize,
  paletteSize
}: {
  document: SpriteDocument;
  name?: string;
  x: number;
  y: number;
  source?: WorkspaceItemSource;
  gridSize?: SpriteSize;
  paletteSize?: ImportPaletteSize;
}): WorkspaceItem {
  const size = gridSize ?? document.canvas.width;

  return {
    id: createId("item"),
    type: "pixel-image",
    name: name ?? document.name,
    x,
    y,
    width: getWorkspaceItemDisplaySize(size),
    height: getWorkspaceItemDisplaySize(size),
    zIndex: 0,
    visible: true,
    locked: false,
    pixelSettings: {
      gridSize: size,
      paletteSize: paletteSize ?? defaultPaletteSize
    },
    source: source ?? {},
    spriteDocument: document
  };
}

export function addWorkspaceItem(
  workspace: CanvasWorkspace,
  item: WorkspaceItem
): CanvasWorkspace {
  const now = getNowIso();
  const nextZIndex =
    workspace.items.reduce((max, current) => Math.max(max, current.zIndex), -1) + 1;

  return {
    ...workspace,
    updatedAt: now,
    items: [
      ...workspace.items,
      {
        ...item,
        zIndex: nextZIndex
      }
    ],
    selectedItemIds: [item.id]
  };
}

export function updateWorkspaceItem(
  workspace: CanvasWorkspace,
  itemId: string,
  updater: (item: WorkspaceItem) => WorkspaceItem
): CanvasWorkspace {
  return {
    ...workspace,
    updatedAt: getNowIso(),
    items: workspace.items.map((item) =>
      item.id === itemId ? updater(item) : item
    )
  };
}

export function selectWorkspaceItem(
  workspace: CanvasWorkspace,
  itemId: string | null
): CanvasWorkspace {
  return {
    ...workspace,
    updatedAt: getNowIso(),
    selectedItemIds: itemId ? [itemId] : []
  };
}

export function selectWorkspaceItems(
  workspace: CanvasWorkspace,
  itemIds: string[]
): CanvasWorkspace {
  const validIds = new Set(workspace.items.map((item) => item.id));

  return {
    ...workspace,
    updatedAt: getNowIso(),
    selectedItemIds: itemIds.filter((id) => validIds.has(id))
  };
}

export function toggleWorkspaceItemSelection(
  workspace: CanvasWorkspace,
  itemId: string
): CanvasWorkspace {
  const selected = new Set(workspace.selectedItemIds);
  if (selected.has(itemId)) {
    selected.delete(itemId);
  } else {
    selected.add(itemId);
  }

  return selectWorkspaceItems(workspace, Array.from(selected));
}

export function moveSelectedWorkspaceItems(
  workspace: CanvasWorkspace,
  deltaX: number,
  deltaY: number
): CanvasWorkspace {
  const selected = new Set(workspace.selectedItemIds);
  if (!selected.size) return workspace;

  return {
    ...workspace,
    updatedAt: getNowIso(),
    items: workspace.items.map((item) =>
      selected.has(item.id)
        ? {
            ...item,
            x: item.x + deltaX,
            y: item.y + deltaY
          }
        : item
    )
  };
}

export function deleteSelectedWorkspaceItems(
  workspace: CanvasWorkspace
): CanvasWorkspace {
  const selected = new Set(workspace.selectedItemIds);
  if (!selected.size) return workspace;

  return {
    ...workspace,
    updatedAt: getNowIso(),
    items: workspace.items.filter((item) => !selected.has(item.id)),
    selectedItemIds: []
  };
}

export function duplicateSelectedWorkspaceItems(
  workspace: CanvasWorkspace,
  offset = 32
): CanvasWorkspace {
  const selected = new Set(workspace.selectedItemIds);
  const selectedItems = workspace.items.filter((item) => selected.has(item.id));
  if (!selectedItems.length) return workspace;

  const maxZIndex = workspace.items.reduce(
    (max, item) => Math.max(max, item.zIndex),
    -1
  );
  const duplicates = selectedItems.map((item, index) => ({
    ...item,
    id: createId("item"),
    name: `${item.name} 副本`,
    x: item.x + offset,
    y: item.y + offset,
    zIndex: maxZIndex + index + 1,
    spriteDocument: {
      ...item.spriteDocument,
      id: createId("sprite")
    }
  }));

  return {
    ...workspace,
    updatedAt: getNowIso(),
    items: [...workspace.items, ...duplicates],
    selectedItemIds: duplicates.map((item) => item.id)
  };
}

export function createWorkspaceSummary(workspace: CanvasWorkspace): WorkspaceSummary {
  const selectedItem =
    workspace.items.find((item) => workspace.selectedItemIds.includes(item.id)) ??
    workspace.items[0];

  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    itemCount: workspace.items.length,
    thumbnail: selectedItem
      ? renderDocumentThumbnail(selectedItem.spriteDocument, 160)
      : "",
  };
}
