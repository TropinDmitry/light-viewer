import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IesParseError, parseIes } from '../src/core/ies-parser';
import { Photometry } from '../src/core/photometry';

// Небольшой файл «как из жизни»: старая версия, запятые, переносы чисел, TILT=INCLUDE, множитель, футы.
const SAMPLE_1995 = `IESNA:LM-63-1995
[TEST] 12345
[MANUFAC] Example
[LUMINAIRE] Downlight
[MORE] second line
TILT=INCLUDE
1
3
0, 45, 90
1.0 0.95
0.9
1 1000 2 3 2 1 1 2 2 0.5
0.9 0.5 20
0 45
90
0 90
100 80 0
50 40 0
`;

describe('parseIes', () => {
  it('читает заголовок, ключевые слова и TILT=INCLUDE', () => {
    const ies = parseIes(SAMPLE_1995);
    expect(ies.version).toBe('IESNA:LM-63-1995');
    expect(ies.keywords.MANUFAC).toBe('Example');
    expect(ies.keywords.LUMINAIRE).toBe('Downlight\nsecond line');
    expect(ies.tilt).toBe('INCLUDE');
    expect(ies.tiltData?.angles).toEqual([0, 45, 90]);
    expect(ies.tiltData?.multiplyingFactors).toEqual([1, 0.95, 0.9]);
  });

  it('читает параметры и переводит футы в метры', () => {
    const ies = parseIes(SAMPLE_1995);
    expect(ies.lampCount).toBe(1);
    expect(ies.lumensPerLamp).toBe(1000);
    expect(ies.candelaMultiplier).toBe(2);
    expect(ies.unitsType).toBe(1);
    expect(ies.widthM).toBeCloseTo(2 * 0.3048, 6);
    expect(ies.heightM).toBeCloseTo(0.5 * 0.3048, 6);
    expect(ies.inputWatts).toBe(20);
    expect(ies.verticalAngles).toEqual([0, 45, 90]);
    expect(ies.horizontalAngles).toEqual([0, 90]);
  });

  it('умножает силы света на множитель и коэффициенты балласта (LM-63-1995)', () => {
    const ies = parseIes(SAMPLE_1995);
    const k = 2 * 0.9 * 0.5; // множитель × балласт × балласт-лампа
    expect(ies.candela[0][0]).toBeCloseTo(100 * k, 9);
    expect(ies.candela[1][1]).toBeCloseTo(40 * k, 9);
  });

  it('в LM-63-2002 поле «future use» не применяется', () => {
    const text = SAMPLE_1995.replace('LM-63-1995', 'LM-63-2002');
    const ies = parseIes(text);
    expect(ies.candela[0][0]).toBeCloseTo(100 * 2 * 0.9, 9);
    expect(ies.warnings.some((w) => w.includes('future use'))).toBe(true);
  });

  it('читает файл без строки версии (LM-63-1986)', () => {
    const text = 'Some free text\nTILT=NONE\n1 -1 1 2 1 1 2 0 0 0\n1 1 10\n0 90\n0\n500 0\n';
    const ies = parseIes(text);
    expect(ies.version).toBe('');
    expect(ies.candela).toEqual([[500, 0]]);
  });

  it('понятная ошибка на обрезанном файле и без TILT', () => {
    expect(() => parseIes('IESNA:LM-63-2002\nTILT=NONE\n1 -1 1 3 1 1 2 0 0 0\n1 1 10\n0 45')).toThrow(IesParseError);
    expect(() => parseIes('просто текст')).toThrow(/TILT/);
  });

  it('разбирает сгенерированные тестовые файлы', () => {
    for (const name of ['lambert.ies', 'narrow.ies', 'wide.ies', 'linear.ies']) {
      const text = readFileSync(join(__dirname, '..', 'demo', 'public', 'ies', name), 'utf8');
      const ies = parseIes(text);
      expect(ies.warnings).toEqual([]);
      expect(ies.photometricType).toBe(1);
    }
  });
});

describe('Photometry', () => {
  it('интерполирует между узлами по γ и по C', () => {
    const p = Photometry.fromIes(parseIes(SAMPLE_1995));
    const k = 0.9;
    expect(p.intensity(0, 0)).toBeCloseTo(100 * k, 6);
    expect(p.intensity(22.5, 0)).toBeCloseTo(90 * k, 6); // середина между 100 и 80
    expect(p.intensity(0, 45)).toBeCloseTo(75 * k, 6); // середина между C0 и C90
  });

  it('разворачивает квадрантную симметрию (C 0…90)', () => {
    const p = Photometry.fromIes(parseIes(SAMPLE_1995));
    expect(p.symmetry).toBe('quadrant');
    expect(p.intensity(0, 180)).toBeCloseTo(p.intensity(0, 0), 9);
    expect(p.intensity(30, 270)).toBeCloseTo(p.intensity(30, 90), 9);
    expect(p.intensity(30, 300)).toBeCloseTo(p.intensity(30, 60), 9);
  });

  it('за пределами таблицы углов сила света равна нулю', () => {
    const p = Photometry.fromIes(parseIes(SAMPLE_1995));
    expect(p.intensity(120, 0)).toBe(0);
  });

  it('замыкает полный набор C-плоскостей по кругу (C 0…270)', () => {
    const p = new Photometry([0, 90], [0, 90, 180, 270], [[100, 0], [200, 0], [300, 0], [400, 0]]);
    expect(p.symmetry).toBe('full');
    expect(p.intensity(0, 315)).toBeCloseTo(250, 9); // между 400 (C270) и 100 (C360 = C0)
  });

  it('поток ламбертовского светильника равен π·I0', () => {
    const angles = Array.from({ length: 91 }, (_, k) => k);
    const i0 = 1000;
    const p = new Photometry(angles, [0], [angles.map((g) => i0 * Math.cos((g * Math.PI) / 180))]);
    expect(p.rawFlux).toBeCloseTo(Math.PI * i0, 0); // ±0.5 лм из ~3142
  });

  it('setTargetLumens масштабирует силу света под заданный поток', () => {
    const p = new Photometry([0, 90], [0], [[100, 0]]);
    p.setTargetLumens(p.rawFlux * 3);
    expect(p.intensity(0, 0)).toBeCloseTo(300, 6);
    expect(p.flux).toBeCloseTo(p.rawFlux * 3, 6);
  });

  it('угол половинной силы света узкого файла около 24°', () => {
    const text = readFileSync(join(__dirname, '..', 'demo', 'public', 'ies', 'narrow.ies'), 'utf8');
    const beam = Photometry.fromIes(parseIes(text)).beamAngles();
    expect(beam.c0).toBeGreaterThan(23.5);
    expect(beam.c0).toBeLessThan(24.5);
  });
});
