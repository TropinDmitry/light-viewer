import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Сборка библиотеки (npm run build:lib) — два файла:
 *  - dist/lib/luminaire-viewer.js — ES-модуль без three (если three на сайте уже подключён);
 *  - dist/lib/luminaire-viewer.standalone.js — всё в одном файле (запуск с --mode standalone),
 *    чтобы вставить на любую страницу одним <script type="module">.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    publicDir: false,
    build: {
      outDir: 'dist/lib',
      emptyOutDir: !standalone,
      sourcemap: true,
      lib: {
        entry: resolve(import.meta.dirname, 'src/register.ts'),
        formats: ['es'],
        fileName: () => (standalone ? 'luminaire-viewer.standalone.js' : 'luminaire-viewer.js'),
      },
      rollupOptions: {
        external: standalone ? [] : [/^three(\/.*)?$/],
      },
    },
  };
});
