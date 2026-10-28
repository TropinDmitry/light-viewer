import { angleRange, writeIes, type IesWriterOptions } from './ies-writer';
import { Photometry } from './photometry';

/**
 * Синтетические светораспределения для демо и тестов.
 * Это НЕ данные реальных светильников — только формулы, похожие на типовые кривые.
 */

export interface TestDistribution {
  fileName: string;
  title: string;
  /** Желаемый световой поток, лм — таблица масштабируется под него. */
  lumens: number;
  options: Omit<IesWriterOptions, 'intensity'> & { shape: (gammaDeg: number, cDeg: number) => number };
}

const DEG = Math.PI / 180;

/** Узкий пучок cosⁿγ: n подобран так, чтобы угол половинной силы света был 24°. */
const NARROW_N = Math.log(0.5) / Math.log(Math.cos(12 * DEG));

export const TEST_DISTRIBUTIONS: TestDistribution[] = [
  {
    fileName: 'lambert.ies',
    title: 'Косинусное (ламбертовское), 3600 лм — как у офисной панели',
    lumens: 3600,
    options: {
      catalogNumber: 'TEST-LAMBERT',
      description: 'Lambertian I = I0*cos(gamma)',
      verticalAngles: angleRange(0, 90, 5),
      horizontalAngles: [0],
      widthM: 0.6,
      lengthM: 0.6,
      heightM: 0,
      inputWatts: 30,
      shape: (g) => Math.cos(g * DEG),
    },
  },
  {
    fileName: 'narrow.ies',
    title: 'Узкое, пучок 24°, 2000 лм — акцентный / промышленный',
    lumens: 2000,
    options: {
      catalogNumber: 'TEST-NARROW-24',
      description: 'Narrow I = I0*cos^n(gamma), 24 deg beam',
      verticalAngles: angleRange(0, 90, 1),
      horizontalAngles: [0],
      widthM: 0.1,
      lengthM: 0.1,
      heightM: 0,
      inputWatts: 18,
      shape: (g) => Math.pow(Math.cos(g * DEG), NARROW_N),
    },
  },
  {
    fileName: 'wide.ies',
    title: 'Широкое «крылья летучей мыши» (batwing), 6000 лм',
    lumens: 6000,
    options: {
      catalogNumber: 'TEST-BATWING',
      description: 'Batwing I = I0*cos(g)*(1 + 2*sin^2(g))',
      verticalAngles: angleRange(0, 90, 2.5),
      horizontalAngles: [0],
      widthM: 0.3,
      lengthM: 0.3,
      heightM: 0,
      inputWatts: 50,
      shape: (g) => Math.cos(g * DEG) * (1 + 2 * Math.sin(g * DEG) ** 2),
    },
  },
  {
    fileName: 'linear.ies',
    title: 'Линейное несимметричное (вдоль шире, поперёк уже), 4000 лм',
    lumens: 4000,
    options: {
      catalogNumber: 'TEST-LINEAR',
      description: 'Linear I = I0*cos^m(g), m = 1 (C0) .. 4 (C90)',
      verticalAngles: angleRange(0, 90, 5),
      horizontalAngles: angleRange(0, 90, 15),
      widthM: 0.07,
      lengthM: 1.2,
      heightM: 0,
      inputWatts: 36,
      shape: (g, c) => Math.pow(Math.cos(g * DEG), 1 + 3 * Math.sin(c * DEG) ** 2),
    },
  },
];

/** Собрать текст IES-файла: форма распределения масштабируется до заданного потока. */
export function buildTestIes(dist: TestDistribution): string {
  const { shape, ...rest } = dist.options;

  // Сначала считаем поток формы с I0 = 1, затем подбираем I0 под нужные люмены.
  const table = rest.horizontalAngles.map((c) => rest.verticalAngles.map((g) => shape(g, c)));
  const unitFlux = new Photometry(rest.verticalAngles, rest.horizontalAngles, table).rawFlux;
  const i0 = dist.lumens / unitFlux;

  return writeIes({ ...rest, intensity: (g, c) => i0 * shape(g, c) });
}
