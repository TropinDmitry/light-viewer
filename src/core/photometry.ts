import type { IesData } from './ies-parser';

/**
 * Фотометрическое тело светильника: сила света I(γ, C) в канделах для любого направления.
 *
 * Система координат фотометрии типа C:
 *   γ (gamma) — вертикальный угол от надира: 0° = прямо вниз, 90° = горизонт, 180° = вверх;
 *   C — горизонтальный угол (C-плоскость) вокруг вертикальной оси светильника:
 *       C0 — вдоль длинной стороны светильника, C90 — поперёк.
 *
 * Между узлами таблицы значения интерполируются билинейно (по γ и по C),
 * симметрии из LM-63 разворачиваются автоматически.
 */

type Symmetry = 'axial' | 'quadrant' | 'bilateral-0-180' | 'bilateral-90-270' | 'full';

export interface BeamInfo {
  /** Угол половинной яркости (50% от максимума) в плоскости C0–C180, градусы. */
  c0: number;
  /** То же в плоскости C90–C270. */
  c90: number;
}

export class Photometry {
  readonly vAngles: number[];
  readonly hAngles: number[];
  readonly table: number[][]; // [h][v], кд (без scale)
  readonly symmetry: Symmetry;
  /** Множитель поверх таблицы (например, чтобы привести к заданному потоку). */
  scale = 1;

  private _rawFlux: number | undefined;

  constructor(vAngles: number[], hAngles: number[], table: number[][]) {
    if (table.length !== hAngles.length || table.some((r) => r.length !== vAngles.length)) {
      throw new Error('Размер таблицы сил света не совпадает с числом углов.');
    }
    this.vAngles = vAngles;
    this.hAngles = hAngles;
    this.table = table;
    this.symmetry = detectSymmetry(hAngles);
  }

  static fromIes(ies: IesData): Photometry {
    return new Photometry(ies.verticalAngles, ies.horizontalAngles, ies.candela);
  }

  /** Сила света, кд, в направлении (γ, C), углы в градусах. */
  intensity(gammaDeg: number, cDeg: number): number {
    return this.rawIntensity(gammaDeg, cDeg) * this.scale;
  }

  /** Полный световой поток светильника по таблице (без учёта scale), лм. */
  get rawFlux(): number {
    if (this._rawFlux === undefined) this._rawFlux = this.integrateFlux();
    return this._rawFlux;
  }

  /** Световой поток с учётом scale, лм. */
  get flux(): number {
    return this.rawFlux * this.scale;
  }

  /** Подогнать scale так, чтобы суммарный поток был равен `lumens`. */
  setTargetLumens(lumens: number | undefined | null): void {
    this.scale = lumens && lumens > 0 && this.rawFlux > 0 ? lumens / this.rawFlux : 1;
  }

  /** Максимальная сила света, кд (с учётом scale). */
  get maxIntensity(): number {
    let m = 0;
    for (const row of this.table) for (const v of row) if (v > m) m = v;
    return m * this.scale;
  }

  /** Углы половинной силы света в плоскостях C0 и C90. */
  beamAngles(): BeamInfo {
    return { c0: this.planeBeam(0), c90: this.planeBeam(90) };
  }

  /**
   * Таблица для GPU: равномерная сетка nG × nC (γ 0…180°, C 0…360° включительно),
   * значения нормированы на максимум. Возвращает данные и максимум (кд, без scale).
   */
  toLut(nG = 361, nC = 145): { data: Float32Array; max: number; nG: number; nC: number } {
    const data = new Float32Array(nG * nC);
    let max = 0;
    for (let j = 0; j < nC; j++) {
      const c = (j / (nC - 1)) * 360;
      for (let i = 0; i < nG; i++) {
        const g = (i / (nG - 1)) * 180;
        const v = this.rawIntensity(g, c);
        data[j * nG + i] = v;
        if (v > max) max = v;
      }
    }
    if (max > 0) for (let k = 0; k < data.length; k++) data[k] /= max;
    return { data, max, nG, nC };
  }

  // ---------------------------------------------------------------------------

  private rawIntensity(gammaDeg: number, cDeg: number): number {
    const v = this.vAngles;
    if (gammaDeg < v[0] || gammaDeg > v[v.length - 1]) return 0;

    const h = this.hAngles;
    if (h.length === 1) return interp1(v, this.table[0], gammaDeg);

    let c = ((cDeg % 360) + 360) % 360;
    switch (this.symmetry) {
      case 'quadrant':
        if (c > 180) c = 360 - c;
        if (c > 90) c = 180 - c;
        break;
      case 'bilateral-0-180':
        if (c > 180) c = 360 - c;
        break;
      case 'bilateral-90-270':
        if (c < 90 || c > 270) c = (((180 - c) % 360) + 360) % 360;
        break;
      case 'full':
        break;
    }

    // Поиск соседних C-плоскостей; для полного набора без 360° замыкаем по кругу.
    const last = h.length - 1;
    let i0: number, i1: number, c0: number, c1: number;
    if (c <= h[0] || c >= h[last]) {
      if (this.symmetry === 'full' && h[last] - h[0] < 360) {
        i0 = last;
        i1 = 0;
        c0 = h[last];
        c1 = h[0] + 360;
        if (c < h[0]) c += 360;
      } else {
        const idx = c <= h[0] ? 0 : last;
        return interp1(v, this.table[idx], gammaDeg);
      }
    } else {
      i1 = upperIndex(h, c);
      i0 = i1 - 1;
      c0 = h[i0];
      c1 = h[i1];
    }
    const t = c1 === c0 ? 0 : (c - c0) / (c1 - c0);
    const a = interp1(v, this.table[i0], gammaDeg);
    const b = interp1(v, this.table[i1], gammaDeg);
    return a + (b - a) * t;
  }

  /** Численное интегрирование Φ = ∫∫ I(γ,C)·sinγ dγ dC методом средних точек. */
  private integrateFlux(): number {
    const g0 = this.vAngles[0];
    const g1 = this.vAngles[this.vAngles.length - 1];
    const dG = 0.25;
    const nG = Math.max(1, Math.round((g1 - g0) / dG));
    const stepG = (g1 - g0) / nG;
    const axial = this.hAngles.length === 1;
    const nC = axial ? 1 : 360;
    const stepC = 360 / nC;
    const rad = Math.PI / 180;
    let sum = 0;
    for (let j = 0; j < nC; j++) {
      const c = (j + 0.5) * stepC;
      for (let i = 0; i < nG; i++) {
        const g = g0 + (i + 0.5) * stepG;
        sum += this.rawIntensity(g, c) * Math.sin(g * rad);
      }
    }
    return sum * stepG * rad * stepC * rad;
  }

  private planeBeam(c: number): number {
    const step = 0.1;
    let max = 0;
    for (let g = 0; g <= 180; g += step) {
      max = Math.max(max, this.rawIntensity(g, c), this.rawIntensity(g, c + 180));
    }
    if (max <= 0) return 0;
    const half = max / 2;
    const edge = (cc: number): number => {
      let seenPeak = false;
      for (let g = 0; g <= 180; g += step) {
        const val = this.rawIntensity(g, cc);
        if (val >= half) seenPeak = true;
        else if (seenPeak) return g;
      }
      return seenPeak ? 180 : 0;
    };
    return edge(c) + edge(c + 180);
  }
}

function detectSymmetry(h: number[]): Symmetry {
  if (h.length === 1) return 'axial';
  const first = h[0];
  const last = h[h.length - 1];
  if (first === 0 && last === 90) return 'quadrant';
  if (first === 0 && last === 180) return 'bilateral-0-180';
  if (first === 90 && last === 270) return 'bilateral-90-270';
  return 'full';
}

/** Индекс первого элемента массива, строго большего x (массив возрастает). */
function upperIndex(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function interp1(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 1) return ys[0];
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const i1 = upperIndex(xs, x);
  const i0 = i1 - 1;
  const t = (x - xs[i0]) / (xs[i1] - xs[i0]);
  return ys[i0] + (ys[i1] - ys[i0]) * t;
}
