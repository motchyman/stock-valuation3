// src/app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "理論株価アナリシス | 東証プライム RIM",
  description: "残余事業利益モデル（RIM）による東証プライム銘柄の理論株価計算ツール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
