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

const sizes: SpriteSize[] = [16, 32, 64, 128, 256];

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
      setStatus(nextSummaries.length ? "项目存档已更新" : "还没有项目，先创建或导入一个精灵图。");
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

  async function handleImportImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setStatus(`正在把「${file.name}」转为 ${selectedSize}x${selectedSize} 可编辑网格...`);

    try {
      const document = await createSpriteDocumentFromPng(file, selectedSize);
      await createProject(document);
      router.push(`/editor/${document.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片导入失败");
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
          <p className="eyebrow">Pixel Animation Studio</p>
          <h1>像素帧动画编辑器</h1>
        </div>
        <div className="archive-controls">
          <PixelButton onClick={() => router.push("/workspace")}>打开像素无限画布</PixelButton>
          <PixelButton variant="secondary" onClick={refresh}>刷新</PixelButton>
        </div>
      </header>

      <div className="workspace-layout editing-only-layout">
        <section className="project-start-panel">
          <div className="start-copy">
            <h2>开始编辑</h2>
            <p>创建空白画布，或导入已有图片，进入编辑器制作像素帧动画。</p>
          </div>

          <div className="generation-toolbar">
            <label className="start-field">
              画布尺寸
              <select
                value={selectedSize}
                onChange={(event) => setSelectedSize(Number(event.target.value) as SpriteSize)}
              >
                {sizes.map((size) => (
                  <option key={size} value={size}>{size}x{size}</option>
                ))}
              </select>
            </label>
            <span>{selectedSize}x{selectedSize} · 透明背景 · 项目保存在本机浏览器</span>
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
            <PixelButton variant="secondary" onClick={handleCreate}>创建空白项目</PixelButton>
          </div>

          <div className="import-actions">
            <div>
              <strong>图片导入</strong>
              <p>支持 PNG、JPG、WebP。透明像素会保留为空格子，导入后可以继续逐像素编辑。</p>
            </div>
            <label className={`pixel-file-button upload-dropzone ${isImporting ? "disabled" : ""}`}>
              <strong>{isImporting ? "导入中..." : "选择图片"}</strong>
              <span>转为 {selectedSize}x{selectedSize} 网格</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                disabled={isImporting}
                onChange={handleImportImage}
              />
            </label>
          </div>

          <p className="status-line">{status}</p>
        </section>
      </div>

      {summaries.length ? (
        <section className="archive-section" aria-label="项目列表">
          <div className="archive-section-top">
            <h2>最近编辑</h2>
            <span>{summaries.length} 个项目</span>
          </div>
          <div className="project-grid">
            {summaries.map((summary) => (
              <ProjectCard
                key={summary.id}
                summary={summary}
                onOpen={(id) => router.push(`/editor/${id}`)}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="empty-archive">
          <h2>没有项目</h2>
          <p>创建空白项目或导入图片，开始制作像素帧动画。</p>
        </section>
      )}
    </main>
  );
}
