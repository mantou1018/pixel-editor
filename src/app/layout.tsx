import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "像素帧动画编辑器",
  description: "导入、像素化、编辑和导出像素帧动画"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
