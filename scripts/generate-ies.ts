// Генерирует тестовые IES-файлы в demo/public/ies. Запуск: npm run gen:ies
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_DISTRIBUTIONS, buildTestIes } from '../src/core/test-distributions';

const outDir = join(import.meta.dirname, '..', 'demo', 'public', 'ies');
mkdirSync(outDir, { recursive: true });

for (const dist of TEST_DISTRIBUTIONS) {
  writeFileSync(join(outDir, dist.fileName), buildTestIes(dist), 'utf8');
  console.log(`✓ ${dist.fileName} — ${dist.title}`);
}
