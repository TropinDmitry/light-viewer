/**
 * Парсер фотометрических файлов IESNA LM-63 (версии 1986, 1991, 1995, 2002).
 *
 * Файл состоит из:
 *   1) необязательной строки версии (`IESNA:LM-63-2002`, `IESNA91` …);
 *   2) строк-ключевых слов вида `[MANUFAC] Diora`;
 *   3) строки `TILT=NONE | INCLUDE | <имя файла>`;
 *   4) потока чисел: 10 параметров светильника, 3 параметра балласта,
 *      вертикальные углы, горизонтальные углы, таблица сил света (кд).
 *
 * Числа в потоке могут переноситься между строками как угодно и разделяться
 * пробелами или запятыми — поэтому числовую часть читаем как токены, а не построчно.
 */

export type PhotometricType = 1 | 2 | 3; // 1 = тип C, 2 = тип B, 3 = тип A

export interface IesTilt {
  /** 1 — лампа вертикально, 2 — горизонтально вдоль C0, 3 — горизонтально вдоль C90. */
  lampToLuminaireGeometry: number;
  angles: number[];
  multiplyingFactors: number[];
}

export interface IesData {
  /** Строка версии из файла, например `IESNA:LM-63-2002`; пусто для LM-63-1986. */
  version: string;
  /** Ключевые слова: `TEST`, `MANUFAC`, `LUMCAT`, `LUMINAIRE`, `LAMP` … */
  keywords: Record<string, string>;
  tilt: 'NONE' | 'INCLUDE' | 'FILE';
  tiltData?: IesTilt;
  lampCount: number;
  /** Световой поток одной лампы, лм. `-1` означает абсолютную фотометрию (LED). */
  lumensPerLamp: number;
  candelaMultiplier: number;
  photometricType: PhotometricType;
  /** Единицы размеров в файле: 1 — футы, 2 — метры. */
  unitsType: 1 | 2;
  /** Размеры светящей части, уже переведены в метры. */
  widthM: number;
  lengthM: number;
  heightM: number;
  ballastFactor: number;
  /** В LM-63-1995 и ранее — «ballast-lamp photometric factor», в 2002 — «future use» (= 1). */
  ballastLampFactor: number;
  inputWatts: number;
  /** Вертикальные углы γ, градусы (для типа C: 0 = надир, вниз). */
  verticalAngles: number[];
  /** Горизонтальные углы C, градусы. */
  horizontalAngles: number[];
  /**
   * Силы света, кд: `candela[h][v]` — для горизонтального угла h и вертикального v.
   * Уже умножены на candelaMultiplier и коэффициенты балласта.
   */
  candela: number[][];
  /** Некритичные замечания, найденные при разборе. */
  warnings: string[];
}

export class IesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IesParseError';
  }
}

const FEET_TO_M = 0.3048;

export function parseIes(text: string): IesData {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const warnings: string[] = [];
  const keywords: Record<string, string> = {};

  let i = 0;
  let version = '';
  if (lines.length && /^IESNA/i.test(lines[0].trim())) {
    version = lines[0].trim();
    i = 1;
  }

  // Ключевые слова до строки TILT. Строка `[MORE]` продолжает предыдущее ключевое слово.
  let lastKey = '';
  let tiltLine = '';
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^TILT\s*=/i.test(line)) {
      tiltLine = line;
      i++;
      break;
    }
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
    if (m) {
      const key = m[1].trim().toUpperCase();
      if (key === 'MORE' && lastKey) {
        keywords[lastKey] += '\n' + m[2];
      } else {
        keywords[key] = m[2];
        lastKey = key;
      }
    }
  }
  if (!tiltLine) throw new IesParseError('Не найдена строка TILT= — файл не похож на IES LM-63.');

  const tiltValue = tiltLine.split('=')[1].trim().toUpperCase();
  const tilt: IesData['tilt'] = tiltValue === 'NONE' ? 'NONE' : tiltValue === 'INCLUDE' ? 'INCLUDE' : 'FILE';
  if (tilt === 'FILE') {
    warnings.push(`TILT ссылается на внешний файл (${tiltValue}); данные наклона не применяются.`);
  }

  // Всё остальное — поток чисел.
  const tokens = lines
    .slice(i)
    .join(' ')
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  let p = 0;
  const next = (what: string): number => {
    if (p >= tokens.length) throw new IesParseError(`Файл обрывается: ожидалось «${what}».`);
    const v = Number(tokens[p++]);
    if (!Number.isFinite(v)) throw new IesParseError(`Не число в поле «${what}»: «${tokens[p - 1]}».`);
    return v;
  };
  const nextArray = (n: number, what: string): number[] => {
    const out = new Array<number>(n);
    for (let k = 0; k < n; k++) out[k] = next(what);
    return out;
  };

  let tiltData: IesTilt | undefined;
  if (tilt === 'INCLUDE') {
    const geometry = next('TILT: геометрия лампы');
    const n = next('TILT: число углов');
    tiltData = {
      lampToLuminaireGeometry: geometry,
      angles: nextArray(n, 'TILT: углы'),
      multiplyingFactors: nextArray(n, 'TILT: множители'),
    };
    warnings.push('TILT=INCLUDE прочитан, но не применяется (нужен только для ламп, чувствительных к наклону).');
  }

  const lampCount = next('число ламп');
  const lumensPerLamp = next('поток лампы');
  const candelaMultiplier = next('множитель силы света');
  const nV = next('число вертикальных углов');
  const nH = next('число горизонтальных углов');
  const photometricType = next('тип фотометрии');
  const unitsType = next('единицы');
  const width = next('ширина');
  const length = next('длина');
  const height = next('высота');
  const ballastFactor = next('коэффициент балласта');
  const ballastLampFactor = next('коэффициент балласт-лампа / резерв');
  const inputWatts = next('мощность');

  if (!Number.isInteger(nV) || nV < 1 || !Number.isInteger(nH) || nH < 1) {
    throw new IesParseError(`Некорректное число углов: вертикальных ${nV}, горизонтальных ${nH}.`);
  }
  if (photometricType !== 1 && photometricType !== 2 && photometricType !== 3) {
    throw new IesParseError(`Неизвестный тип фотометрии: ${photometricType}.`);
  }
  if (photometricType !== 1) {
    warnings.push(
      `Тип фотометрии ${photometricType === 2 ? 'B' : 'A'}: модуль рассчитан на тип C, распределение будет интерпретировано неточно.`,
    );
  }
  if (unitsType !== 1 && unitsType !== 2) {
    warnings.push(`Неизвестный тип единиц ${unitsType}, считаем метрами.`);
  }

  const verticalAngles = nextArray(nV, 'вертикальные углы');
  const horizontalAngles = nextArray(nH, 'горизонтальные углы');
  checkAscending(verticalAngles, 'Вертикальные');
  checkAscending(horizontalAngles, 'Горизонтальные');

  // В LM-63-2002 поле «future use» должно быть 1; в старых версиях это реальный коэффициент.
  const is2002 = /2002|2019/.test(version);
  const factor = candelaMultiplier * ballastFactor * (is2002 ? 1 : ballastLampFactor);
  if (is2002 && ballastLampFactor !== 1) {
    warnings.push(`Поле «future use» = ${ballastLampFactor} (по LM-63-2002 должно быть 1), игнорируем.`);
  }

  const candela: number[][] = [];
  for (let h = 0; h < nH; h++) {
    const row = nextArray(nV, 'силы света');
    candela.push(row.map((v) => v * factor));
  }
  if (p < tokens.length) {
    warnings.push(`После таблицы сил света остались лишние данные (${tokens.length - p} значений).`);
  }

  const toM = unitsType === 1 ? FEET_TO_M : 1;
  return {
    version,
    keywords,
    tilt,
    tiltData,
    lampCount,
    lumensPerLamp,
    candelaMultiplier,
    photometricType: photometricType as PhotometricType,
    unitsType: unitsType === 1 ? 1 : 2,
    widthM: width * toM,
    lengthM: length * toM,
    heightM: height * toM,
    ballastFactor,
    ballastLampFactor,
    inputWatts,
    verticalAngles,
    horizontalAngles,
    candela,
    warnings,
  };
}

function checkAscending(a: number[], name: string): void {
  for (let k = 1; k < a.length; k++) {
    if (!(a[k] > a[k - 1])) throw new IesParseError(`${name} углы должны возрастать (позиция ${k}).`);
  }
}
