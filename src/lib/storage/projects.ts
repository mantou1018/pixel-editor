import type { ProjectSummary, SpriteDocument } from "@/domain/sprite/types";
import { createSummary, getNowIso, renameDocument } from "@/domain/sprite/document";
import { createWorkspaceSummary } from "@/domain/workspace/document";
import type {
  CanvasWorkspace,
  WorkspaceItem,
  WorkspaceItemSource,
  WorkspaceSummary
} from "@/domain/workspace/types";

const dbName = "sprite-tool-mvp";
const dbVersion = 4;
const summaryStore = "project_summaries";
const documentStore = "project_documents";
const generationWorkspaceStore = "generation_workspace";
const generationWorkspaceKey = "default";
const workspaceSummaryStore = "workspace_summaries";
const workspaceDocumentStore = "workspace_documents";
const workspaceSpriteStore = "workspace_sprite_documents";

type StoredWorkspaceItem = Omit<WorkspaceItem, "spriteDocument" | "source"> & {
  spriteId: string;
  source: Omit<WorkspaceItemSource, "dataUrl">;
};

type StoredWorkspace = Omit<CanvasWorkspace, "items"> & {
  items: StoredWorkspaceItem[];
};

export interface GenerationWorkspaceState {
  id: typeof generationWorkspaceKey;
  history: unknown[];
  favoriteCandidateIds: string[];
  updatedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(summaryStore)) {
        db.createObjectStore(summaryStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(documentStore)) {
        db.createObjectStore(documentStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(generationWorkspaceStore)) {
        db.createObjectStore(generationWorkspaceStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(workspaceSummaryStore)) {
        db.createObjectStore(workspaceSummaryStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(workspaceDocumentStore)) {
        db.createObjectStore(workspaceDocumentStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(workspaceSpriteStore)) {
        db.createObjectStore(workspaceSpriteStore, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const db = await openDb();
  const transaction = db.transaction(summaryStore, "readonly");
  const store = transaction.objectStore(summaryStore);
  const summaries = await requestToPromise<ProjectSummary[]>(store.getAll());
  db.close();
  return summaries.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function loadProject(id: string): Promise<SpriteDocument | null> {
  const db = await openDb();
  const transaction = db.transaction(documentStore, "readonly");
  const store = transaction.objectStore(documentStore);
  const document = await requestToPromise<SpriteDocument | undefined>(store.get(id));
  db.close();
  return document ?? null;
}

export async function saveProject(document: SpriteDocument): Promise<ProjectSummary> {
  const updatedDocument: SpriteDocument = {
    ...document,
    updatedAt: getNowIso()
  };
  const summary = createSummary(updatedDocument);
  const db = await openDb();
  const transaction = db.transaction([summaryStore, documentStore], "readwrite");
  transaction.objectStore(documentStore).put(updatedDocument);
  transaction.objectStore(summaryStore).put(summary);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
  return summary;
}

export async function createProject(document: SpriteDocument) {
  return saveProject(document);
}

export async function renameProject(id: string, name: string): Promise<SpriteDocument> {
  const document = await loadProject(id);
  if (!document) {
    throw new Error("项目不存在");
  }
  const renamed = renameDocument(document, name);
  await saveProject(renamed);
  return renamed;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([summaryStore, documentStore], "readwrite");
  transaction.objectStore(documentStore).delete(id);
  transaction.objectStore(summaryStore).delete(id);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
}

export async function loadGenerationWorkspace(): Promise<GenerationWorkspaceState | null> {
  const db = await openDb();
  const transaction = db.transaction(generationWorkspaceStore, "readonly");
  const store = transaction.objectStore(generationWorkspaceStore);
  const state = await requestToPromise<GenerationWorkspaceState | undefined>(
    store.get(generationWorkspaceKey)
  );
  db.close();
  return state ?? null;
}

export async function saveGenerationWorkspace(
  state: Omit<GenerationWorkspaceState, "id" | "updatedAt">
): Promise<GenerationWorkspaceState> {
  const nextState: GenerationWorkspaceState = {
    id: generationWorkspaceKey,
    updatedAt: getNowIso(),
    ...state
  };
  const db = await openDb();
  const transaction = db.transaction(generationWorkspaceStore, "readwrite");
  transaction.objectStore(generationWorkspaceStore).put(nextState);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
  return nextState;
}

export async function listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const db = await openDb();
  const transaction = db.transaction(workspaceSummaryStore, "readonly");
  const store = transaction.objectStore(workspaceSummaryStore);
  const summaries = await requestToPromise<WorkspaceSummary[]>(store.getAll());
  db.close();
  return summaries.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function loadWorkspace(id: string): Promise<CanvasWorkspace | null> {
  const db = await openDb();
  const transaction = db.transaction([workspaceDocumentStore, workspaceSpriteStore], "readonly");
  const store = transaction.objectStore(workspaceDocumentStore);
  const workspace = await requestToPromise<(CanvasWorkspace | StoredWorkspace) | undefined>(store.get(id));
  if (!workspace) {
    db.close();
    return null;
  }

  if (workspace.items.every((item) => "spriteDocument" in item)) {
    db.close();
    return workspace as CanvasWorkspace;
  }

  const spriteStore = transaction.objectStore(workspaceSpriteStore);
  const spriteIds = (workspace as StoredWorkspace).items.map((item) => item.spriteId);
  const sprites = await Promise.all(spriteIds.map((spriteId) => requestToPromise<SpriteDocument | undefined>(spriteStore.get(spriteId))));
  db.close();
  const spriteById = new Map(sprites.filter((sprite): sprite is SpriteDocument => Boolean(sprite)).map((sprite) => [sprite.id, sprite]));
  const stored = workspace as StoredWorkspace;
  return {
    ...stored,
    items: stored.items.flatMap((item) => {
      const spriteDocument = spriteById.get(item.spriteId);
      return spriteDocument ? [{ ...item, source: { ...item.source }, spriteDocument }] : [];
    })
  };
}

export async function saveWorkspace(
  workspace: CanvasWorkspace
): Promise<WorkspaceSummary> {
  const updatedWorkspace: CanvasWorkspace = {
    ...workspace,
    updatedAt: getNowIso()
  };
  const summary = createWorkspaceSummary(updatedWorkspace);
  const storedWorkspace: StoredWorkspace = {
    ...updatedWorkspace,
    items: updatedWorkspace.items.map(({ spriteDocument, source, ...item }) => ({
      ...item,
      spriteId: spriteDocument.id,
      source: {
        fileName: source.fileName,
        mimeType: source.mimeType
      }
    }))
  };
  const db = await openDb();
  const transaction = db.transaction(
    [workspaceSummaryStore, workspaceDocumentStore, workspaceSpriteStore],
    "readwrite"
  );
  transaction.objectStore(workspaceDocumentStore).put(storedWorkspace);
  const spriteStore = transaction.objectStore(workspaceSpriteStore);
  updatedWorkspace.items.forEach((item) => spriteStore.put(item.spriteDocument));
  transaction.objectStore(workspaceSummaryStore).put(summary);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
  return summary;
}

export async function deleteWorkspace(id: string): Promise<void> {
  const workspace = await loadWorkspace(id);
  const db = await openDb();
  const transaction = db.transaction(
    [workspaceSummaryStore, workspaceDocumentStore, workspaceSpriteStore],
    "readwrite"
  );
  transaction.objectStore(workspaceDocumentStore).delete(id);
  transaction.objectStore(workspaceSummaryStore).delete(id);
  const spriteStore = transaction.objectStore(workspaceSpriteStore);
  workspace?.items.forEach((item) => spriteStore.delete(item.spriteDocument.id));

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
}
