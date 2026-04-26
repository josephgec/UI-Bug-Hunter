import type { ReactNode } from "react";

export const metadata = {
  title: "UI Bug Hunter",
  description: "Phase 1 internal alpha",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: 0,
          background: "#0b0d10",
          color: "#e8eaed",
        }}
      >
        {children}
      </body>
    </html>
  );
}
