/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Prisma + Next standalone need this hint for tracing.
    serverComponentsExternalPackages: ["@prisma/client", "ioredis"],
  },
  transpilePackages: ["@ubh/shared", "@ubh/db"],
};

export default nextConfig;
