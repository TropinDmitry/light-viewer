// Сохраняет процедурную заглушку «таблетка» в demo/public/models/sample-puck.glb —
// чтобы проверить загрузку настоящего GLB-файла. Запуск: npm run gen:glb
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPlaceholder } from '../src/core/models';

// GLTFExporter рассчитан на браузер и читает Blob через FileReader. В Node его нет —
// подставляем минимальную замену с тем же поведением.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

// Делаем модель «как из CAD»: в миллиметрах и с отдельным именем рассеивателя,
// чтобы проверить автоматическое масштабирование и поиск рассеивателя.
const model = createPlaceholder('puck');
model.scale.setScalar(1000);
const scene = new THREE.Scene();
scene.add(model);

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, { binary: true });
const outDir = join(import.meta.dirname, '..', 'demo', 'public', 'models');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sample-puck.glb'), Buffer.from(result as ArrayBuffer));
console.log('✓ demo/public/models/sample-puck.glb');
