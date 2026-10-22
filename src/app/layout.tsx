import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Supervisão de Atendimento", template: "%s · Supervisão" },
  description: "Gestão interna da supervisão de atendimento.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#100904",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full bg-walnut text-cream antialiased">{children}</body>
    </html>
  );
}
