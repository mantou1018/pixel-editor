"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { PixelButton } from "@/components/PixelButton";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { createSpriteDocument } from "@/domain/sprite/document";
import { createSpriteDocumentFromPng } from "@/domain/sprite/importPng";
import type { ProjectSummary, SpriteSize } from "@/domain/sprite/types";
import {
  createProject,
  deleteProject,
  listProjectSummaries,
  renameProject
} from "@/lib/storage/projects";

const sizes: SpriteSize[] = [16, 32, 64];

export default function ProjectsPage() {
  const router = useRouter();
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [selectedSize, setSelectedSize] = useState<SpriteSize>(64);
  const [projectName, setProjectName] = useState("新的精灵图");
  const [status, setStatus] = useState("读取本地项目库...");
  const [isImporting, setIsImporting] = useState(false);

  async function refresh() {
    try {
      const nextSummaries = await listProjectSummaries();
      setSummaries(nextSummaries);
      setStatus(nextSummaries.length ? "项目存档已更新" : "还没有项目，先创建一个精灵图。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取项目失败");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    const document = createSpriteDocument({
      name: projectName.trim() || "新的精灵图",
      size: selectedSize
    });
    await createProject(document);
    router.push(`/editor/${document.id}`);
  }

  async function handleImportPng(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setStatus(`正在把「${file.name}」转为 ${selectedSize}x${selectedSize} 可编辑网格...`);

    try {
      const document = await createSpriteDocumentFromPng(file, selectedSize);
      await createProject(document);
      router.push(`/editor/${document.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PNG 导入失败");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  async function handleRename(id: string) {
    const current = summaries.find((summary) => summary.id === id);
    const name = window.prompt("输入新的项目名", current?.name ?? "");
    if (!name) return;
    await renameProject(id, name);
    await refresh();
  }

  async function handleDelete(id: string) {
    const current = summaries.find((summary) => summary.id === id);
    const ok = window.confirm(`确认删除「${current?.name ?? "这个项目"}」吗？此操作不可撤销。`);
    if (!ok) return;
    await deleteProject(id);
    await refresh();
  }

  return (
    <main className="projects-page">
      <header className="archive-topbar">
        <div>
          <p className="eyebrow">Sprite Archive</p>
          <h1>项目存档</h1>
        </div>
        <div className="archive-controls">
          <span>第01/01页</span>
          <PixelButton variant="secondary" onClick={refresh}>
            刷新
          </PixelButton>
        </div>
      </header>

      <section className="project-start-panel">
        <div className="start-copy">
          <h2>新建或导入精灵图</h2>
          <p>选择尺寸后，可以从空白画布开始，也可以把 PNG 转成可编辑像素网格。</p>
        </div>

        <div className="size-switcher" aria-label="选择尺寸">
          {sizes.map((size) => (
            <button
              key={size}
              className={selectedSize === size ? "active" : ""}
              onClick={() => setSelectedSize(size)}
            >
              {size}x{size}
            </button>
          ))}
        </div>

        <div className="start-actions">
          <label className="start-field">
            项目名称
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              aria-label="项目名称"
            />
          </label>
          <PixelButton onClick={handleCreate}>创建空白项目</PixelButton>
        </div>

        <div className="import-actions">
          <div>
            <strong>PNG 导入</strong>
            <p>透明像素会保留为空格子，导入后可继续用画笔和橡皮逐格编辑。</p>
          </div>
          <label className={`pixel-file-button ${isImporting ? "disabled" : ""}`}>
            {isImporting ? "导入中..." : "选择 PNG 并转为网格"}
            <input
              type="file"
              accept="image/png,.png"
              disabled={isImporting}
              onChange={handleImportPng}
            />
          </label>
        </div>
      </section>

      <div className="archive-status">{status}</div>

      {summaries.length ? (
        <section className="project-grid" aria-label="项目列表">
          {summaries.map((summary) => (
            <ProjectCard
              key={summary.id}
              summary={summary}
              onOpen={(id) => router.push(`/editor/${id}`)}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))}
        </section>
      ) : (
        <section className="empty-archive">
          <h2>没有项目</h2>
          <p>创建一个 16x16、32x32 或 64x64 精灵图项目开始。</p>
        </section>
      )}
    </main>
  );
}
