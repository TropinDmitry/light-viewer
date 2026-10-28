/**
 * Цветовая шкала для карты освещённости (тёмно-синий → голубой → зелёный → жёлтый → красный → белый).
 * Одна и та же шкала используется в шейдере (через текстуру) и в легенде, поэтому цвета совпадают.
 */

type Rgb = [number, number, number];

const STOPS: { t: number; color: Rgb }[] = [
  { t: 0.0, color: [0.05, 0.05, 0.35] },
  { t: 0.15, color: [0.1, 0.3, 0.9] },
  { t: 0.35, color: [0.1, 0.8, 0.9] },
  { t: 0.5, color: [0.2, 0.85, 0.3] },
  { t: 0.68, color: [0.98, 0.9, 0.15] },
  { t: 0.85, color: [0.95, 0.35, 0.1] },
  { t: 1.0, color: [1.0, 0.95, 0.9] },
];

/** Цвет для доли t ∈ [0, 1], компоненты 0…1. */
export function colorAt(t: number): Rgb {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < STOPS.length; k++) {
    if (x <= STOPS[k].t) {
      const a = STOPS[k - 1];
      const b = STOPS[k];
      const f = (x - a.t) / (b.t - a.t);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * f,
        a.color[1] + (b.color[1] - a.color[1]) * f,
        a.color[2] + (b.color[2] - a.color[2]) * f,
      ];
    }
  }
  return STOPS[STOPS.length - 1].color;
}

/** RGBA-пиксели шкалы шириной `size` (для DataTexture). */
export function colormapPixels(size = 256): Uint8Array {
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = colorAt(i / (size - 1));
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export function cssColorAt(t: number): string {
  const [r, g, b] = colorAt(t);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** «Круглый» верх шкалы (1; 1.5; 2; 2.5; 3; 4; 5; 7.5 × 10ⁿ) — чтобы подписи легенды были ровными. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= m * power) return m * power;
  }
  return 10 * power;
}
