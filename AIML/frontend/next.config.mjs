/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "pdf-parse",
    "ws",
    "bufferutil",
    "utf-8-validate",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@radix-ui/react-icons"],
  },
};

export default nextConfig;
