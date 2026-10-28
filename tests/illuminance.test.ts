import { describe, expect, it } from 'vitest';
import { computeGrid, computeStats, illuminanceAt } from '../src/core/illuminance';
import { Photometry } from '../src/core/photometry';

/**
 * Ручной расчёт для сверки.
 *
 * Светильник с ламбертовским распределением I(γ) = I0·cos γ, поток 1000 лм.
 * Поток ламбертовского излучателя Φ = π·I0  →  I0 = 1000 / π ≈ 318.31 кд.
 * Высота над расчётной плоскостью h = 2.5 м.
 *
 * Точка прямо под светильником: γ = 0, d = h, угол падения 0:
 *     E = I0 / h² = 318.31 / 6.25 ≈ 50.93 лк
 *
 * Точка со смещением 2.5 м по горизонтали: γ = 45°, d = 2.5·√2 ≈ 3.536 м:
 *     I = I0·cos45° ≈ 225.08 кд, cos(угла падения) = cos45° ≈ 0.7071
 *     E = 225.08 · 0.7071 / 12.5 ≈ 12.73 лк   (то же, что I0·cos⁴γ / h²)
 */
const I0 = 1000 / Math.PI;
const H = 2.5;

function lambert(): Photometry {
  // Мелкий шаг по γ, чтобы линейная интерполяция таблицы почти не вносила ошибку.
  const angles = Array.from({ length: 181 }, (_, k) => k * 0.5);
  return new Photometry(angles, [0], [angles.map((g) => I0 * Math.cos((g * Math.PI) / 180))]);
}

const lum = { position: [0, H, 0] as [number, number, number] };

describe('прямая освещённость: сверка с ручным расчётом', () => {
  it('точка прямо под светильником: E = I0 / h²', () => {
    const e = illuminanceAt(lambert(), [lum], [0, 0, 0]);
    expect(e).toBeCloseTo(50.93, 2);
  });

  it('точка под углом 45°: E = I0·cos⁴γ / h²', () => {
    const e = illuminanceAt(lambert(), [lum], [2.5, 0, 0]);
    expect(e).toBeCloseTo(12.73, 2);
    // тот же результат в любом направлении (распределение осесимметричное)
    expect(illuminanceAt(lambert(), [lum], [0, 0, -2.5])).toBeCloseTo(12.73, 2);
  });

  it('точка под углом 60° (смещение h·√3)', () => {
    const e = illuminanceAt(lambert(), [lum], [H * Math.sqrt(3), 0, 0]);
    expect(e).toBeCloseTo((I0 * 0.5 ** 4) / H ** 2, 2); // ≈ 3.18 лк
  });

  it('вертикальная поверхность (стена): учитывается свой угол падения', () => {
    // Стена в плоскости x = 2.5, нормаль смотрит на светильник (−X). Точка на высоте пола.
    // γ = 45°, луч падает на стену под углом 45° к её нормали → E та же, что на полу.
    const e = illuminanceAt(lambert(), [lum], [2.5, 0, 0], [-1, 0, 0]);
    expect(e).toBeCloseTo(12.73, 2);
    // Если нормаль отвернуть — освещённость ноль
    expect(illuminanceAt(lambert(), [lum], [2.5, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('над светильником (γ > 90°) ламбертовский светильник не светит', () => {
    expect(illuminanceAt(lambert(), [lum], [0, 3, 0], [0, -1, 0])).toBe(0);
  });
});

describe('суммирование по нескольким светильникам', () => {
  it('два светильника: в точке между ними — сумма двух вкладов', () => {
    const p = lambert();
    const a = { position: [-2.5, H, 0] as [number, number, number] };
    const b = { position: [2.5, H, 0] as [number, number, number] };
    // В середине каждый даёт 45° → 12.73 лк, вместе 25.46
    expect(illuminanceAt(p, [a, b], [0, 0, 0])).toBeCloseTo(2 * 12.73, 2);
    // Под одним из них: 50.93 (свой) + вклад второго с расстояния 5 м по горизонтали
    const gamma = Math.atan(5 / H);
    const fromFar = (I0 * Math.cos(gamma) ** 4) / H ** 2;
    expect(illuminanceAt(p, [a, b], [-2.5, 0, 0])).toBeCloseTo(50.93 + fromFar, 2);
  });

  it('четыре одинаковых светильника в углах квадрата дают в центре 4× вклад одного', () => {
    const p = lambert();
    const corners: [number, number, number][] = [
      [-1, H, -1],
      [1, H, -1],
      [-1, H, 1],
      [1, H, 1],
    ];
    const lums = corners.map((position) => ({ position }));
    const one = illuminanceAt(p, [lums[0]], [0, 0, 0]);
    expect(illuminanceAt(p, lums, [0, 0, 0])).toBeCloseTo(4 * one, 9);
  });

  it('поворот светильника меняет картину для несимметричного распределения', () => {
    // C0 — 100 кд, C90 — 0 кд (квадрантная симметрия)
    const p = new Photometry([0, 90], [0, 90], [[100, 100], [100, 0]]);
    const point: [number, number, number] = [2, 0, 0]; // вдоль X = в плоскости C0
    const straight = illuminanceAt(p, [{ position: [0, 2, 0] }], point);
    const turned = illuminanceAt(p, [{ position: [0, 2, 0], rotationY: Math.PI / 2 }], point);
    expect(straight).toBeGreaterThan(turned);
    // γ = 45°: в C0 I = 100, в C90 I = 50
    expect(straight).toBeCloseTo((100 * Math.SQRT1_2) / 8, 6);
    expect(turned).toBeCloseTo((50 * Math.SQRT1_2) / 8, 6);
  });
});

describe('сетка и статистика', () => {
  it('статистика: min, max, среднее, равномерность', () => {
    const s = computeStats([100, 200, 300]);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.average).toBe(200);
    expect(s.uniformity).toBeCloseTo(0.5, 9);
    expect(s.minToMax).toBeCloseTo(1 / 3, 9);
  });

  it('сетка: максимум под светильником, симметрия значений', () => {
    const grid = computeGrid(lambert(), [lum], {
      minX: -2,
      maxX: 2,
      minZ: -2,
      maxZ: 2,
      height: 0,
      countX: 5,
      countZ: 5,
    });
    expect(grid.xs).toEqual([-1.6, -0.8, 0, 0.8, 1.6].map((v) => expect.closeTo(v, 9)));
    const center = grid.values[2 * 5 + 2];
    expect(center).toBeCloseTo(50.93, 2);
    expect(grid.stats.max).toBeCloseTo(center, 9);
    expect(grid.values[0]).toBeCloseTo(grid.values[24], 9); // противоположные углы
  });
});
