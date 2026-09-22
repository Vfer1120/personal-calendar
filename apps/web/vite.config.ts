import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        id: "/",
        name: "个人日程",
        short_name: "日程",
        description: "移动优先、离线可用的个人日程与任务管理工具",
        theme_color: "#f97316",
        background_color: "#fffaf5",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        scope: "/",
        orientation: "any",
        start_url: "/",
        lang: "zh-CN",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      }
    })
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  },
  preview: {
    host: "127.0.0.1",
    allowedHosts: true,
    port: 5174,
    proxy: { "/api": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000" }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000" }
  }
});
