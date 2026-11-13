import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: {
    // Uploads de fotos de celular (até 5 MB cada, várias por envio). Padrão do Next: 1 MB.
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;
