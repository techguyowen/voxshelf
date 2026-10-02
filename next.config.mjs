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
  // Baseline hardening headers (no script CSP: Next hydration + Google
  // Fonts need inline scripts/styles, and the threat model is single-user).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
