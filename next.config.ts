import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
};

export default nextConfig;
