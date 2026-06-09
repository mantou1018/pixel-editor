# 像素图生成器开发记录

## 2026-06-09：文字生成像素图工作流第一阶段

### 变更

- 新增 `src/domain/sprite/generate.ts`：
  - 定义 `PixelGenerationStyle`、生成请求和候选类型。
  - 用提示词、尺寸和风格生成 4 个稳定候选。
  - 候选结果直接生成 `SpriteDocument`，可进入编辑器继续修改。
- 更新 `src/app/projects/page.tsx`：
  - 增加“文字生成像素图”区域。
  - 支持提示词输入、风格选择、生成候选、选择候选进入编辑器。
- 更新 `src/app/globals.css`：
  - 增加生成面板、风格选择、候选卡片和移动端布局样式。
- 更新 `src/app/editor/[projectId]/page.tsx`：
  - 右侧面板显示生成来源。
  - 把原来的“AI 生成占位”改为“基于当前图再生成”的下一阶段入口说明。
- 新增 `src/app/icon.svg`：
  - 提供应用图标，避免浏览器 favicon 请求 404。
- `next-env.d.ts`：
  - Next 构建自动把类型引用从 `.next/dev/types/routes.d.ts` 更新为 `.next/types/routes.d.ts`。

### 说明

当前生成逻辑是本地占位，不调用真实 AI。它的价值是先把“输入描述 -> 生成候选 -> 选择结果 -> 编辑导出”的产品闭环跑通。
