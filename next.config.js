/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Permite upload de midia (base64) via server actions ate ~5MB.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

module.exports = nextConfig;
