import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type safety is enforced: the production build must fail on TypeScript
  // errors, never hide them. (scripts/ and other dev-only directories are
  // excluded from type-checking via tsconfig.json.)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
