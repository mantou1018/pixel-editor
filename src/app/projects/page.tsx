"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { PixelButton } from "@/components/PixelButton";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { createSpriteDocument } from "@/domain/sprite/document";
import {
  generatePixelCandidates,
  type PixelGenerationCandidate,
  type PixelGenerationStyle
} from "@/domain/sprite/generate";
import {
  createSpriteDocumentFromPng,
  type ImportPaletteSize
} from "@/domain/sprite/importPng";
import { renderDocumentThumbnail } from "@/domain/sprite/render";
import type { ProjectSummary, SpriteSize } from "@/domain/sprite/types";
import {
  createProject,
  deleteProject,
  loadGenerationWorkspace,
  listProjectSummaries,
  renameProject,
  saveGenerationWorkspace
} from "@/lib/storage/projects";

const sizes: SpriteSize[] = [16, 32, 64];
const importPaletteSizes: ImportPaletteSize[] = [8, 16, 32, 64];
const generationStyles: Array<{ id: PixelGenerationStyle; label: string; hint: string }> = [
  { id: "rpg-character", label: "RPG 角色", hint: "适合人物、职业、站立精灵" },
  { id: "cute-pet", label: "可爱宠物", hint: "适合小狗、小猫、伙伴动物" },
  { id: "item-icon", label: "道具图标", hint: "适合物品、徽章、技能图标" },
  { id: "avatar", label: "头像", hint: "适合社交头像、表情、NPC 头部" }
];
type GenerationHistoryItem = {
  id: string;
  prompt: string;
  size: SpriteSize;
  style: PixelGenerationStyle;
  createdAt: string;
  candidates: PixelGenerationCandidate[];
};

function isGenerationHistoryItem(item: unknown): item is GenerationHistoryItem {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<GenerationHistoryItem>;
  return (
    typeof value.id === "string" &&
    typeof value.prompt === "string" &&
    typeof value.createdAt === "string" &&
    (value.size === 16 || value.size === 32 || value.size === 64) &&
    generationStyles.some((style) => style.id === value.style) &&
    Array.isArray(value.candidates)
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [selectedSize, setSelectedSize] = useState<SpriteSize>(64);
  const [importPaletteSize, setImportPaletteSize] =
    useState<ImportPaletteSize>(32);
  const [projectName, setProjectName] = useState("新的精灵图");
  const [prompt, setPrompt] = useState("一只黄色小狗，正面，像素风");
  const [generationStyle, setGenerationStyle] =
    useState<PixelGenerationStyle>("cute-pet");
  const [candidates, setCandidates] = useState<PixelGenerationCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
  const [favoriteCandidateIds, setFavoriteCandidateIds] = useState<string[]>([]);
  const [status, setStatus] = useState("读取本地项目库...");
  const [isImporting, setIsImporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  const favoriteCandidates = useMemo(() => {
    const allCandidates = generationHistory.flatMap((item) => item.candidates);
    return favoriteCandidateIds
      .map((id) => allCandidates.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is PixelGenerationCandidate => Boolean(candidate));
  }, [favoriteCandidateIds, generationHistory]);

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

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const state = await loadGenerationWorkspace();
        if (state) {
          const history = state.history.filter(isGenerationHistoryItem).slice(0, 6);
          setGenerationHistory(history);
          setFavoriteCandidateIds(state.favoriteCandidateIds);
          if (history[0]) {
            setPrompt(history[0].prompt);
            setSelectedSize(history[0].size);
            setGenerationStyle(history[0].style);
            setCandidates(history[0].candidates);
            setSelectedCandidateId(history[0].candidates[0]?.id ?? null);
          }
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "生成工作台读取失败");
      } finally {
        setWorkspaceLoaded(true);
      }
    }

    loadWorkspace();
  }, []);

  useEffect(() => {
    if (!workspaceLoaded) return;

    saveGenerationWorkspace({
      history: generationHistory,
      favoriteCandidateIds
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : "生成工作台保存失败");
    });
  }, [favoriteCandidateIds, generationHistory, workspaceLoaded]);

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
    setStatus(
      `正在把「${file.name}」转为 ${selectedSize}x${selectedSize} 可编辑网格，并归并为 ${importPaletteSize} 色...`
    );

    try {
      const document = await createSpriteDocumentFromPng(file, selectedSize, {
        paletteSize: importPaletteSize
      });
      await createProject(document);
      router.push(`/editor/${document.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PNG 导入失败");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  function handleGenerate() {
    setIsGenerating(true);
    setStatus("正在生成 4 个可编辑像素候选...");

    window.setTimeout(() => {
      const nextCandidates = generatePixelCandidates({
        prompt,
        size: selectedSize,
        style: generationStyle
      });
      const historyItem: GenerationHistoryItem = {
        id: `history_${Date.now().toString(36)}`,
        prompt: prompt.trim() || "未命名像素图",
        size: selectedSize,
        style: generationStyle,
        createdAt: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit"
        }),
        candidates: nextCandidates
      };
      setCandidates(nextCandidates);
      setGenerationHistory((current) => [historyItem, ...current].slice(0, 6));
      setSelectedCandidateId(nextCandidates[0]?.id ?? null);
      setIsGenerating(false);
      setStatus("已生成候选，选择一个进入编辑器继续修色。");
    }, 260);
  }

  function handleReuseHistory(item: GenerationHistoryItem) {
    setPrompt(item.prompt);
    setSelectedSize(item.size);
    setGenerationStyle(item.style);
    setCandidates(item.candidates);
    setSelectedCandidateId(item.candidates[0]?.id ?? null);
    setStatus("已恢复历史候选，可继续选择或重新生成。");
  }

  function handleToggleFavorite(candidate: PixelGenerationCandidate) {
    setFavoriteCandidateIds((current) => {
      if (current.includes(candidate.id)) {
        setStatus(`已取消收藏：${candidate.title}`);
        return current.filter((id) => id !== candidate.id);
      }

      setStatus(`已收藏：${candidate.title}`);
      return [candidate.id, ...current];
    });
  }

  async function handleUseCandidate(candidate: PixelGenerationCandidate) {
    await createProject(candidate.document);
    router.push(`/editor/${candidate.document.id}`);
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
            <p>透明像素会保留为空格子，导入时会按调色板数量减少碎色。</p>
          </div>
          <div className="import-palette-control" aria-label="选择导入调色板数量">
            {importPaletteSizes.map((size) => (
              <button
                key={size}
                className={importPaletteSize === size ? "active" : ""}
                onClick={() => setImportPaletteSize(size)}
                type="button"
              >
                {size} 色
              </button>
            ))}
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

      <section className="generation-panel">
        <div className="generation-copy">
          <h2>文字生成像素图</h2>
          <p>先用本地占位生成跑通工作流：输入描述，得到 4 个候选，选择后进入编辑器继续改色和导出。</p>
        </div>

        <label className="prompt-field">
          提示词
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="例如：一只黄色小狗，正面，透明背景，适合 64x64 精灵图"
          />
        </label>

        <div className="generation-style-list" aria-label="选择生成风格">
          {generationStyles.map((style) => (
            <button
              key={style.id}
              className={generationStyle === style.id ? "active" : ""}
              onClick={() => setGenerationStyle(style.id)}
            >
              <strong>{style.label}</strong>
              <span>{style.hint}</span>
            </button>
          ))}
        </div>

        <div className="generation-actions">
          <PixelButton onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "生成中..." : "生成 4 个候选"}
          </PixelButton>
          <span>
            {selectedSize}x{selectedSize} · 透明背景 · 可编辑像素块 · 历史和收藏保存在本机浏览器
          </span>
        </div>

        {candidates.length ? (
          <div className="candidate-grid" aria-label="生成候选">
            {candidates.map((candidate) => (
              <article
                key={candidate.id}
                className={`candidate-card ${
                  selectedCandidateId === candidate.id ? "active" : ""
                }`}
              >
                <button
                  className="candidate-preview"
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  aria-label={`选择${candidate.title}`}
                >
                  <img
                    src={renderDocumentThumbnail(candidate.document, 180)}
                    alt={candidate.title}
                  />
                </button>
                <div>
                  <h3>{candidate.title}</h3>
                  <p>{candidate.description}</p>
                </div>
                <div className="candidate-actions">
                  <button
                    className="candidate-favorite-button"
                    onClick={() => handleToggleFavorite(candidate)}
                    type="button"
                  >
                    {favoriteCandidateIds.includes(candidate.id) ? "已收藏" : "收藏"}
                  </button>
                  <PixelButton onClick={() => handleUseCandidate(candidate)}>
                    选中并编辑
                  </PixelButton>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {favoriteCandidates.length ? (
          <section className="favorite-candidates" aria-label="收藏候选">
            <div className="generation-history-top">
              <h3>收藏候选</h3>
              <span>{favoriteCandidates.length} 个可编辑方案</span>
            </div>
            <div className="favorite-grid">
              {favoriteCandidates.map((candidate) => (
                <article key={candidate.id} className="favorite-card">
                  <img
                    src={renderDocumentThumbnail(candidate.document, 120)}
                    alt={candidate.title}
                  />
                  <div>
                    <strong>{candidate.title}</strong>
                    <p>{candidate.description}</p>
                  </div>
                  <button onClick={() => handleUseCandidate(candidate)}>编辑此收藏</button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {generationHistory.length ? (
          <section className="generation-history" aria-label="生成历史">
            <div className="generation-history-top">
              <h3>生成历史</h3>
              <span>保留最近 {generationHistory.length} 轮</span>
            </div>
            <div className="history-list">
              {generationHistory.map((item) => (
                <article key={item.id} className="history-row">
                  <div>
                    <strong>{item.prompt}</strong>
                    <p>
                      {item.size}x{item.size} ·{" "}
                      {generationStyles.find((style) => style.id === item.style)?.label} ·{" "}
                      {item.createdAt}
                    </p>
                  </div>
                  <button onClick={() => handleReuseHistory(item)}>再次使用</button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
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
