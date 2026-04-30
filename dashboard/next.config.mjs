import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  outputFileTracingRoot: dashboardRoot,
  devIndicators: false,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
