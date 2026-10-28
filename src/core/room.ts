import type { LuminairePlacement } from './illuminance';

/**
 * Помещение и расстановка светильников.
 * Начало координат — центр пола. X — длина помещения, Z — ширина, Y — высота.
 */

export type RoomPresetName = 'studio' | 'office' | 'warehouse' | 'street';

export interface RoomConfig {
  preset: RoomPresetName;
  /** Длина (по X) и ширина (по Z), м. */
  length: number;
  width: number;
  /** Высота потолка, м. 0 — без стен и потолка (улица, студия). */
  height: number;
  /** Высота подвеса светильников (от пола до рассеивателя), м. */
  mountHeight: number;
  /** Высота рабочей плоскости, м (офис — 0.8, склад и улица — 0). */
  workplaneHeight: number;
  /** Сетка светильников: число вдоль X и вдоль Z. */
  countX: number;
  countZ: number;
  /** Шаг между светильниками, м. 0 — равномерно по помещению. */
  spacingX: number;
  spacingZ: number;
  /** Повернуть светильники на 90° (C0 вдоль Z). */
  rotated: boolean;
  /** Коэффициенты отражения поверхностей — только для картинки, в расчёт люксов не входят. */
  floorReflectance: number;
  wallReflectance: number;
}

export const ROOM_PRESETS: Record<RoomPresetName, RoomConfig & { title: string }> = {
  studio: {
    title: 'Студия (один светильник)',
    preset: 'studio',
    length: 6,
    width: 6,
    height: 0,
    mountHeight: 2,
    workplaneHeight: 0,
    countX: 1,
    countZ: 1,
    spacingX: 0,
    spacingZ: 0,
    rotated: false,
    floorReflectance: 0.5,
    wallReflectance: 0.5,
  },
  office: {
    title: 'Офис 6 × 4 × 3 м',
    preset: 'office',
    length: 6,
    width: 4,
    height: 3,
    mountHeight: 3,
    workplaneHeight: 0.8,
    countX: 3,
    countZ: 2,
    spacingX: 0,
    spacingZ: 0,
    rotated: false,
    floorReflectance: 0.3,
    wallReflectance: 0.7,
  },
  warehouse: {
    title: 'Склад 24 × 12 × 8 м',
    preset: 'warehouse',
    length: 24,
    width: 12,
    height: 8,
    mountHeight: 7.5,
    workplaneHeight: 0,
    countX: 6,
    countZ: 3,
    spacingX: 0,
    spacingZ: 0,
    rotated: false,
    floorReflectance: 0.25,
    wallReflectance: 0.5,
  },
  street: {
    title: 'Улица: дорога 40 × 12 м',
    preset: 'street',
    length: 40,
    width: 12,
    height: 0,
    mountHeight: 8,
    workplaneHeight: 0,
    countX: 3,
    countZ: 1,
    spacingX: 0,
    spacingZ: 0,
    rotated: false,
    floorReflectance: 0.1,
    wallReflectance: 0,
  },
};

export function roomFromPreset(name: RoomPresetName): RoomConfig {
  const { title: _title, ...config } = ROOM_PRESETS[name];
  return { ...config };
}

/**
 * Координаты светильников сеткой countX × countZ с центром в середине помещения.
 * При шаге 0 светильники расставляются «равномерно»: шаг = размер / количество,
 * то есть от стены до крайнего светильника — половина шага.
 */
export function layoutLuminaires(room: RoomConfig): LuminairePlacement[] {
  const stepX = room.spacingX > 0 ? room.spacingX : room.length / room.countX;
  const stepZ = room.spacingZ > 0 ? room.spacingZ : room.width / room.countZ;
  const result: LuminairePlacement[] = [];
  for (let iz = 0; iz < room.countZ; iz++) {
    for (let ix = 0; ix < room.countX; ix++) {
      const x = (ix - (room.countX - 1) / 2) * stepX;
      const z = (iz - (room.countZ - 1) / 2) * stepZ;
      result.push({
        position: [x, room.mountHeight, z],
        rotationY: room.rotated ? Math.PI / 2 : 0,
      });
    }
  }
  return result;
}
