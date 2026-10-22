import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Aplicação interna, 100% dinâmica e autenticada: Cache Components desativado.
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pdfkit", "exceljs", "pg"],
  // Arquivos de métricas de fonte lidos pelo PDFKit em tempo de execução
  outputFileTracingIncludes: { "/api/relatorios": ["./node_modules/pdfkit/js/data/**/*"] },
  experimental: {
    authInterrupts: true,
    serverActions: { bodySizeLimit: "12mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;