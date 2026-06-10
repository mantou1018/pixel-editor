import type { ProjectSummary, SpriteDocument } from "@/domain/sprite/types";
import { createSummary, getNowIso, renameDocument } from "@/domain/sprite/document";

const dbName = "sprite-tool-mvp";
const dbVersion = 2;
const summaryStore = "project_summaries";
const documentStore = "project_documents";
const generationWorkspaceStore = "generation_workspace";
const generationWorkspaceKey = "default";

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
