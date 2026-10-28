// Публичное API библиотеки. Для подключения одним тегом см. src/register.ts.
export { parseIes, IesParseError, type IesData } from './core/ies-parser';
export { Photometry } from './core/photometry';
export {
  illuminanceAt,
  illuminanceFromOne,
  computeGrid,
  computeStats,
  type LuminairePlacement,
  type LuxStats,
  type GridOptions,
  type GridResult,
} from './core/illuminance';
export { ROOM_PRESETS, roomFromPreset, layoutLuminaires, type RoomConfig, type RoomPresetName } from './core/room';
export { createPlaceholder, loadModel, type PlaceholderShape } from './core/models';
export { drawPolarCurve, createPhotometricSolid } from './core/photometric-shapes';
export { LuminaireViewer, type ViewMode, type ViewerState, type PhotometryInfo } from './core/viewer';
export { LuminaireViewerElement, defineLuminaireViewer } from './element';
