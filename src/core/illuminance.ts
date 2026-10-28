import type { Photometry } from './photometry';

/**
 * Расчёт прямой освещённости (без отражений от стен и потолка).
 *
 * Для одного светильника и точки P на поверхности с нормалью n:
 *
 *     E = I(γ, C) · cos(α) / d²
 *
 *   d — расстояние от светильника до точки, м;
 *   I(γ, C) — сила света светильника в направлении на точку, кд;
 *   α — угол падения луча на поверхность (между лучом и нормалью).
 *
 * От нескольких светильников освещённости просто складываются.
 *
 * Оси как в Three.js: Y — вверх, пол лежит в плоскости XZ.
 * Светильник смотрит вниз (надир = −Y). Плоскость C0 направлена вдоль оси X светильника,
 * углы C растут против часовой стрелки, если смотреть сверху (от +X к −Z).
 */

export type Vec3 = [number, number, number];

export interface LuminairePlacement {
  /** Положение фотометрического центра (обычно — центр рассеивателя), м. */
  position: Vec3;
  /** Поворот вокруг вертикальной оси, радианы (как rotation.y в Three.js). */
  rotationY?: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/** Освещённость в точке от одного светильника, лк. */
export function illuminanceFromOne(
  photometry: Photometry,
  luminaire: LuminairePlacement,
  point: Vec3,
  normal: Vec3,
): number {
  // Вектор от светильника к точке
  const vx = point[0] - luminaire.position[0];
  const vy = point[1] - luminaire.position[1];
  const vz = point[2] - luminaire.position[2];
  const distSq = vx * vx + vy * vy + vz * vz;
  if (distSq < 1e-9) return 0;
  const dist = Math.sqrt(distSq);

  // cos угла падения: нормаль поверхности против направления луча
  const cosIncidence = -(normal[0] * vx + normal[1] * vy + normal[2] * vz) / dist;
  if (cosIncidence <= 0) return 0; // поверхность отвёрнута от светильника

  // γ: угол от надира. Надир — это −Y, поэтому cos γ = −vy / d
  const gamma = Math.acos(clamp(-vy / dist, -1, 1)) * RAD_TO_DEG;

  // C: переводим вектор в систему светильника (снимаем поворот вокруг Y) и берём азимут
  const r = luminaire.rotationY ?? 0;
  const localX = vx * Math.cos(r) - vz * Math.sin(r);
  const localZ = vx * Math.sin(r) + vz * Math.cos(r);
  let c = Math.atan2(-localZ, localX) * RAD_TO_DEG;
  if (c < 0) c += 360;

  const intensity = photometry.intensity(gamma, c);
  return (intensity * cosIncidence) / distSq;
}

/** Суммарная освещённость в точке от всех светильников, лк. */
export function illuminanceAt(
  photometry: Photometry,
  luminaires: LuminairePlacement[],
  point: Vec3,
  normal: Vec3 = [0, 1, 0],
): number {
  let total = 0;
  for (const lum of luminaires) {
    total += illuminanceFromOne(photometry, lum, point, normal);
  }
  return total;
}

export interface GridOptions {
  /** Границы расчётной области по X и Z, м. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Высота расчётной (рабочей) плоскости, м. */
  height: number;
  /** Число расчётных точек по X и по Z. */
  countX: number;
  countZ: number;
}

export interface GridResult {
  /** Значения в лк, построчно: values[iz * countX + ix]. */
  values: Float32Array;
  countX: number;
  countZ: number;
  /** Координаты точек сетки по осям. */
  xs: number[];
  zs: number[];
  stats: LuxStats;
}

export interface LuxStats {
  min: number;
  max: number;
  average: number;
  /** Равномерность U0 = Emin / Eср. */
  uniformity: number;
  /** Отношение Emin / Emax. */
  minToMax: number;
}

/**
 * Освещённость в узлах сетки на горизонтальной плоскости.
 * Точки ставятся в центры ячеек (как принято в EN 12464 / DIALux 🔎), край области не попадает в расчёт.
 */
export function computeGrid(
  photometry: Photometry,
  luminaires: LuminairePlacement[],
  options: GridOptions,
): GridResult {
  const { countX, countZ } = options;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let ix = 0; ix < countX; ix++) {
    xs.push(options.minX + ((ix + 0.5) / countX) * (options.maxX - options.minX));
  }
  for (let iz = 0; iz < countZ; iz++) {
    zs.push(options.minZ + ((iz + 0.5) / countZ) * (options.maxZ - options.minZ));
  }

  const values = new Float32Array(countX * countZ);
  for (let iz = 0; iz < countZ; iz++) {
    for (let ix = 0; ix < countX; ix++) {
      values[iz * countX + ix] = illuminanceAt(photometry, luminaires, [xs[ix], options.height, zs[iz]]);
    }
  }
  return { values, countX, countZ, xs, zs, stats: computeStats(values) };
}

export function computeStats(values: ArrayLike<number>): LuxStats {
  if (values.length === 0) return { min: 0, max: 0, average: 0, uniformity: 0, minToMax: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const average = sum / values.length;
  return {
    min,
    max,
    average,
    uniformity: average > 0 ? min / average : 0,
    minToMax: max > 0 ? min / max : 0,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
