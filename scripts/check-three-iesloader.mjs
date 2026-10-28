// Проверка поведения IESLoader из three/addons на нашем ламбертовском файле.
// Запуск: node scripts/check-three-iesloader.mjs
import { readFileSync } from 'node:fs';
import { FloatType, REVISION } from 'three';
import { IESLoader } from 'three/addons/loaders/IESLoader.js';

const text = readFileSync(new URL('../demo/public/ies/lambert.ies', import.meta.url), 'utf8');
const loader = new IESLoader();
loader.type = FloatType;
const tex = loader.parse(text);
const d = tex.image.data;

console.log(`three r${REVISION}`);
console.log(`Размер текстуры: ${tex.image.width} x ${tex.image.height}, элементов в массиве: ${d.length}`);
console.log('γ° | IESLoader (норм.) | cos γ (ожидаемо) | cos² γ');
for (const g of [0, 30, 45, 60, 80, 90, 120]) {
  const c = Math.cos((g * Math.PI) / 180);
  console.log(`${g} | ${d[g].toFixed(3)} | ${Math.max(c, 0).toFixed(3)} | ${(c * c).toFixed(3)}`);
}
