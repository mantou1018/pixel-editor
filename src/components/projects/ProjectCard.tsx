"use client";

import type { ProjectSummary } from "@/domain/sprite/types";
import { PixelButton } from "@/components/PixelButton";

interface ProjectCardProps {
  summary: ProjectSummary;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ProjectCard({
  summary,
  onOpen,
  onRename,
  onDelete
}: ProjectCardProps) {
  return (
    <article className="project-card">
      <div className="project-thumb-wrap">
        {summary.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="project-thumb"
            src={summary.thumbnail}
            alt={`${summary.name} 缩略图`}
          />
        ) : (
          <div className="project-thumb empty">无预览</div>
        )}
        <span className="project-badge">{summary.status === "saved" ? "已保存" : "草稿"}</span>
      </div>
      <div className="project-card-body">
        <h2>{summary.name}</h2>
        <p>
          {summary.canvasWidth}x{summary.canvasHeight} · {summary.animationCount} 动作 ·{" "}
          {summary.frameCount} 帧
        </p>
        <time>{new Date(summary.updatedAt).toLocaleString("zh-CN")}</time>
        <div className="project-actions">
          <PixelButton onClick={() => onOpen(summary.id)}>打开编辑</PixelButton>
          <PixelButton variant="secondary" onClick={() => onRename(summary.id)}>
            重命名
          </PixelButton>
          <PixelButton variant="danger" onClick={() => onDelete(summary.id)}>
            删除
          </PixelButton>
        </div>
      </div>
    </article>
  );
}
