import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Supervisão de Atendimento", template: "%s · Supervisão" },
  description: "Gestão interna da supervisão de atendimento.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
