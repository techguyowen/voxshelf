/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "tesseract.js",
    "pdf-parse",
    "mammoth",
    "jsdom",
    "jszip",
  ],
  output: "standalone",
};

export default nextConfig;
