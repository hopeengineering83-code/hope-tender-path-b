/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse and mammoth load binary test fixtures at require() time when
  // bundled by webpack. Externalizing them lets Node.js require natively.
  serverExternalPackages: ["pdf-parse", "mammoth", "bcryptjs", "xlsx"],

  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
