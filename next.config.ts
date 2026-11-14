import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Permite um build de produção local ao lado do `next dev` (ex.: NEXT_DIST_DIR=.next-prod).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
  experimental: {
    // Uploads de fotos de celular (até 5 MB cada, várias por envio). Padrão do Next: 1 MB.
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;
