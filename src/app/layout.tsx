import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "精灵图制作工具",
  description: "生成、像素化、编辑和导出精灵图"
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
