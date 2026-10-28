import { resolve } from "node:path";
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Демостраница (npm run dev / npm run build:demo). Корень — папка demo.
export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/demo',
    emptyOutDir: true,
    // three.js сам по себе ~700 КБ; для демо это нормально, предупреждение не нужно
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // Две страницы: React-демо и пример вставки в обычный HTML
      input: {
        main: resolve(import.meta.dirname, "demo/index.html"),
        embed: resolve(import.meta.dirname, "demo/embed.html"),
      },
    },
  },
});
