import { useEffect, useRef } from "react";
import { renderDocumentToCanvas } from "@/domain/sprite/render";
import type { SpriteDocument } from "@/domain/sprite/types";

interface PixelSvgPreviewProps {
  document: SpriteDocument;
  showGrid?: boolean;
  gridCellSize?: number;
  className?: string;
}

export function PixelSvgPreview({
  document,
  showGrid = false,
  gridCellSize = 0,
  className
}: PixelSvgPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = document.canvas.width;
  const height = document.canvas.height;
  const shouldRenderGrid = showGrid && gridCellSize >= 4;
  const gridLineWidth = 1 / Math.max(gridCellSize, 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderDocumentToCanvas(canvas, document, {
      showCheckerboard: false,
      showGrid: false,
      scale: 1
    });
  }, [document]);

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="workspace-pixel-preview" />
      {shouldRenderGrid ? (
        <svg
          className="workspace-vector-grid"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
        >
          <g
            fill="none"
            stroke="rgba(15, 23, 42, 0.4)"
            strokeWidth={gridLineWidth}
            shapeRendering="crispEdges"
          >
            {Array.from({ length: width + 1 }, (_, index) => (
              <line key={`vertical-${index}`} x1={index} y1="0" x2={index} y2={height} />
            ))}
            {Array.from({ length: height + 1 }, (_, index) => (
              <line key={`horizontal-${index}`} x1="0" y1={index} x2={width} y2={index} />
            ))}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
