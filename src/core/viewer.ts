import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { niceMax } from './colormap';
import { parseIes } from './ies-parser';
import { computeGrid, illuminanceAt, type LuminairePlacement, type LuxStats } from './illuminance';
import { createSurfaceMaterial, LightingData, MAX_LUMINAIRES } from './lighting-material';
import { createPlaceholder, findDiffuserMaterials, loadModel, type PlaceholderShape } from './models';
import { createPhotometricSolid } from './photometric-shapes';
import { Photometry } from './photometry';
import { layoutLuminaires, roomFromPreset, type RoomConfig, type RoomPresetName } from './room';

/**
 * LuminaireViewer — ядро модуля без привязки к фреймворку.
 * Создаёт canvas внутри переданного элемента и рисует светильник / помещение.
 *
 * Рендерим «по требованию»: кадр перерисовывается только когда что-то изменилось
 * (поворот камеры, новые параметры) — встроенный в страницу модуль не грузит процессор зря.
 */

export type ViewMode = 'render' | 'lux';

export interface PhotometryInfo {
  flux: number;
  maxIntensity: number;
  beamC0: number;
  beamC90: number;
  manufacturer: string;
  catalogNumber: string;
  description: string;
  warnings: string[];
}

export interface ViewerState {
  stats: LuxStats;
  /** Верх цветовой шкалы, лк. */
  scaleMax: number;
  luminaireCount: number;
  room: RoomConfig;
  photometry: PhotometryInfo | null;
}

export interface ViewerOptions {
  /** Вызывается после каждого пересчёта сетки освещённости. */
  onUpdate?: (state: ViewerState) => void;
}

const FLOOR_COLOR = new THREE.Color(0.85, 0.8, 0.72);
const WALL_COLOR = new THREE.Color(0.95, 0.94, 0.92);
const GROUND_COLOR = new THREE.Color(0.6, 0.6, 0.62);

// Общие для всех светильников геометрии тросов и опор: единичной высоты, растягиваем через scale.
// Так при перестройке сетки не нужно ничего освобождать.
const UNIT_CABLE = new THREE.CylinderGeometry(0.003, 0.003, 1, 6);
const UNIT_POLE = new THREE.CylinderGeometry(0.08, 0.12, 1, 12);
const UNIT_ARM = new THREE.BoxGeometry(0.06, 0.06, 1);
const MOUNTING_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.4 });

export class LuminaireViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  readonly controls: OrbitControls;

  private container: HTMLElement;
  private options: ViewerOptions;
  private lighting = new LightingData();
  private resizeObserver: ResizeObserver;
  private renderPending = false;

  // Состояние
  private photometry: Photometry | null = null;
  private photometryInfo: PhotometryInfo | null = null;
  private lumens: number | null = null;
  private room: RoomConfig = roomFromPreset('studio');
  private placements: LuminairePlacement[] = [];
  private view: ViewMode = 'render';
  private glow = true;
  private lightOn = true;
  private exposureFactor = 1;
  private fixedMaxLux: number | null = null;
  private showSolid = false;
  private lastState: ViewerState | null = null;
  // Номера последних запросов: если пользователь быстро сменил файл, ответ на старый запрос игнорируем
  private iesRequest = 0;
  private modelRequest = 0;

  // Объекты сцены
  private modelTemplate: THREE.Object3D = createPlaceholder('linear');
  private roomGroup = new THREE.Group();
  private luminaireGroup = new THREE.Group();
  private luxPlane: THREE.Mesh | null = null;
  private solid: THREE.Mesh | null = null;

  constructor(container: HTMLElement, options: ViewerOptions = {}) {
    this.container = container;
    this.options = options;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Окружение для отражений на металлическом корпусе светильника
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.6;
    this.scene.background = new THREE.Color(0x1d2026);

    this.scene.add(this.roomGroup, this.luminaireGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rebuildRoom(true);
  }

  // --- Публичное API --------------------------------------------------------

  /** Загрузить IES по адресу. */
  async loadIes(url: string): Promise<void> {
    const request = ++this.iesRequest;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не удалось загрузить IES (${response.status}): ${url}`);
    const text = await response.text();
    if (request === this.iesRequest) this.setIesText(text);
  }

  /** Задать IES из текста (например, из выбранного пользователем файла). */
  setIesText(text: string): void {
    const ies = parseIes(text);
    const photometry = Photometry.fromIes(ies);
    photometry.setTargetLumens(this.lumens);
    this.photometry = photometry;
    const beam = photometry.beamAngles();
    this.photometryInfo = {
      flux: photometry.flux,
      maxIntensity: photometry.maxIntensity,
      beamC0: beam.c0,
      beamC90: beam.c90,
      manufacturer: ies.keywords.MANUFAC ?? '',
      catalogNumber: ies.keywords.LUMCAT ?? '',
      description: ies.keywords.LUMINAIRE ?? '',
      warnings: ies.warnings,
    };
    this.lighting.setPhotometry(photometry);
    this.updateSolid();
    this.recalculate();
  }

  /** Световой поток светильника, лм. null — как в IES-файле. */
  setLumens(lumens: number | null): void {
    this.lumens = lumens && lumens > 0 ? lumens : null;
    if (!this.photometry) return;
    this.photometry.setTargetLumens(this.lumens);
    if (this.photometryInfo) {
      this.photometryInfo.flux = this.photometry.flux;
      this.photometryInfo.maxIntensity = this.photometry.maxIntensity;
    }
    this.lighting.setPhotometry(this.photometry);
    this.recalculate();
  }

  /** Загрузить GLB/GLTF-модель. */
  async loadModel(url: string): Promise<void> {
    const request = ++this.modelRequest;
    const model = await loadModel(url);
    if (request === this.modelRequest) this.setModelObject(model);
  }

  /** Процедурная заглушка вместо модели. */
  setPlaceholder(shape: PlaceholderShape): void {
    this.modelRequest++; // отменяет ещё не завершённую загрузку GLB
    this.setModelObject(createPlaceholder(shape));
  }

  setPreset(name: RoomPresetName): void {
    this.room = roomFromPreset(name);
    this.rebuildRoom(true);
  }

  /** Изменить отдельные параметры помещения (высота подвеса, сетка, шаг…). */
  setRoom(changes: Partial<RoomConfig>): void {
    const presetChanged = changes.preset !== undefined && changes.preset !== this.room.preset;
    this.room = { ...(presetChanged ? roomFromPreset(changes.preset!) : this.room), ...changes };
    this.room.countX = clampInt(this.room.countX, 1, 32);
    this.room.countZ = clampInt(this.room.countZ, 1, 32);
    this.rebuildRoom(presetChanged);
  }

  getRoom(): RoomConfig {
    return { ...this.room };
  }

  setView(view: ViewMode): void {
    this.view = view;
    if (this.luxPlane) this.luxPlane.visible = view === 'lux';
    this.requestRender();
  }

  /** Свечение рассеивателя (эмиссия материала модели). */
  setGlow(on: boolean): void {
    this.glow = on;
    this.applyGlow();
    this.requestRender();
  }

  /** Включить/выключить свет от светильников в помещении. */
  setLightOn(on: boolean): void {
    this.lightOn = on;
    this.lighting.setLuminaires(this.placements, on);
    this.recalculate();
  }

  /** Множитель экспозиции «реалистичной» картинки (1 — авто). */
  setExposure(factor: number): void {
    this.exposureFactor = factor > 0 ? factor : 1;
    this.updateExposure();
    this.requestRender();
  }

  /** Верх цветовой шкалы, лк; null — автоматически по максимуму. */
  setMaxLux(value: number | null): void {
    this.fixedMaxLux = value && value > 0 ? value : null;
    this.recalculate();
  }

  setShowSolid(show: boolean): void {
    this.showSolid = show;
    this.updateSolid();
    this.requestRender();
  }

  getState(): ViewerState | null {
    return this.lastState;
  }

  /** Освещённость в точке рабочей плоскости под курсором (координаты относительно окна). */
  luxAtScreen(clientX: number, clientY: number): { lux: number; x: number; z: number } | null {
    if (!this.photometry) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.room.workplaneHeight);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit || Math.abs(hit.x) > this.room.length / 2 || Math.abs(hit.z) > this.room.width / 2) return null;
    const placements = this.lightOn ? this.placements : [];
    return { lux: illuminanceAt(this.photometry, placements, [hit.x, hit.y, hit.z]), x: hit.x, z: hit.z };
  }

  /** Камера в исходное положение для текущего помещения. */
  resetCamera(): void {
    const r = this.room;
    if (r.preset === 'studio') {
      this.camera.position.set(1.6, r.mountHeight + 0.5, 2.4);
      this.controls.target.set(0, r.mountHeight * 0.55, 0);
    } else {
      const size = Math.max(r.length, r.width);
      const top = Math.max(r.height, r.mountHeight);
      this.camera.position.set(size * 0.55, top + size * 0.6, size * 0.85);
      this.controls.target.set(0, top * 0.25, 0);
    }
    this.controls.update();
    this.requestRender();
  }

  /** Вид сверху — удобно смотреть карту освещённости. */
  topView(): void {
    const r = this.room;
    const size = Math.max(r.length, r.width * (this.camera.aspect || 1));
    const distance = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) + Math.max(r.height, r.mountHeight);
    this.camera.position.set(0, distance * 1.05, 0.001);
    this.controls.target.set(0, r.workplaneHeight, 0);
    this.controls.update();
    this.requestRender();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    disposeObject(this.roomGroup);
    disposeObject(this.modelTemplate);
    this.lighting.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- Внутреннее -----------------------------------------------------------

  private setModelObject(model: THREE.Object3D): void {
    this.modelTemplate = model;
    this.rebuildLuminaires();
    this.requestRender();
  }

  private rebuildRoom(resetCamera: boolean): void {
    disposeObject(this.roomGroup);
    this.roomGroup.clear();
    const r = this.room;

    const realistic = (color: THREE.Color, reflectance: number, normalSign = 1, side: THREE.Side = THREE.FrontSide) =>
      createSurfaceMaterial(this.lighting, {
        mode: 'realistic',
        albedo: color.clone().multiplyScalar(reflectance),
        normalSign,
        side,
      });

    if (r.height > 0) {
      // Коробка комнаты видна изнутри (BackSide): ближние к камере стены не загораживают вид
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(r.length, r.height, r.width),
        [
          realistic(WALL_COLOR, r.wallReflectance, -1, THREE.BackSide), // +X
          realistic(WALL_COLOR, r.wallReflectance, -1, THREE.BackSide), // −X
          realistic(WALL_COLOR, 0.8, -1, THREE.BackSide), // потолок
          realistic(FLOOR_COLOR, r.floorReflectance, -1, THREE.BackSide), // пол
          realistic(WALL_COLOR, r.wallReflectance, -1, THREE.BackSide), // +Z
          realistic(WALL_COLOR, r.wallReflectance, -1, THREE.BackSide), // −Z
        ],
      );
      box.position.y = r.height / 2;
      this.roomGroup.add(box);
    } else {
      // Улица и студия: только земля, с запасом вокруг расчётной области
      const margin = r.preset === 'street' ? 10 : 4;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(r.length + margin * 2, r.width + margin * 2),
        realistic(GROUND_COLOR, r.floorReflectance),
      );
      ground.rotation.x = -Math.PI / 2;
      this.roomGroup.add(ground);
    }

    // Рабочая плоскость с картой освещённости (видна в режиме «люксы»)
    this.luxPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(r.length, r.width),
      createSurfaceMaterial(this.lighting, { mode: 'falseColor', albedo: new THREE.Color(1, 1, 1) }),
    );
    this.luxPlane.rotation.x = -Math.PI / 2;
    this.luxPlane.position.y = r.workplaneHeight + 0.003; // чуть выше пола, чтобы не мерцало
    this.luxPlane.visible = this.view === 'lux';
    this.roomGroup.add(this.luxPlane);

    this.scene.background = new THREE.Color(r.preset === 'street' ? 0x0b0f1a : 0x1d2026);

    this.placements = layoutLuminaires(r).slice(0, MAX_LUMINAIRES);
    this.lighting.setLuminaires(this.placements, this.lightOn);
    this.rebuildLuminaires();
    if (resetCamera) this.resetCamera();
    this.recalculate();
  }

  private rebuildLuminaires(): void {
    // Копии модели делят геометрию и материалы с шаблоном, поэтому здесь ничего не освобождаем.
    // Плюс: свечение достаточно включить у одного материала — загорятся все копии.
    this.luminaireGroup.clear();
    for (const place of this.placements) {
      const instance = this.modelTemplate.clone(true);
      const holder = new THREE.Group();
      holder.position.set(...place.position);
      holder.rotation.y = place.rotationY ?? 0;
      holder.add(instance);
      this.addMounting(holder, place);
      this.luminaireGroup.add(holder);
    }
    this.applyGlow();
    this.updateSolid();
  }

  /** Тросы подвеса до потолка или опора для улицы. */
  private addMounting(holder: THREE.Group, place: LuminairePlacement): void {
    const r = this.room;
    const top = new THREE.Box3().setFromObject(holder.children[0]).max.y;
    if (r.height > 0 && place.position[1] + top < r.height - 0.02) {
      const length = r.height - place.position[1] - top;
      for (const dx of [-0.3, 0.3]) {
        const cable = new THREE.Mesh(UNIT_CABLE, MOUNTING_MATERIAL);
        cable.scale.y = length;
        cable.position.set(dx * Math.min(1, this.modelSpanX()), top + length / 2, 0);
        holder.add(cable);
      }
    }
    if (r.preset === 'street') {
      const poleZ = r.width / 2 + 0.5; // опора у края дороги
      const pole = new THREE.Mesh(UNIT_POLE, MOUNTING_MATERIAL);
      pole.scale.y = place.position[1] + 0.3;
      pole.position.set(0, -place.position[1] / 2 + 0.15, poleZ);
      const arm = new THREE.Mesh(UNIT_ARM, MOUNTING_MATERIAL);
      arm.scale.z = poleZ;
      arm.position.set(0, 0.3, poleZ / 2);
      holder.add(pole, arm);
    }
  }

  private modelSpanX(): number {
    const size = new THREE.Box3().setFromObject(this.modelTemplate).getSize(new THREE.Vector3());
    return size.x;
  }

  private applyGlow(): void {
    this.luminaireGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of findDiffuserMaterials(mesh)) {
        material.emissiveIntensity = this.glow ? 4 : 0;
      }
    });
  }

  private updateSolid(): void {
    if (this.solid) {
      this.solid.removeFromParent();
      disposeObject(this.solid);
      this.solid = null;
    }
    const first = this.luminaireGroup.children[0];
    if (!this.showSolid || !this.photometry || !first) return;
    this.solid = createPhotometricSolid(this.photometry, Math.min(1.5, this.room.mountHeight * 0.4));
    first.add(this.solid);
  }

  /** Пересчёт сетки освещённости, шкалы и экспозиции. */
  private recalculate(): void {
    if (!this.photometry) {
      this.requestRender();
      return;
    }
    const r = this.room;
    const step = Math.max(r.length, r.width) / 48;
    const grid = computeGrid(this.photometry, this.lightOn ? this.placements : [], {
      minX: -r.length / 2,
      maxX: r.length / 2,
      minZ: -r.width / 2,
      maxZ: r.width / 2,
      height: r.workplaneHeight,
      countX: clampInt(Math.round(r.length / step), 8, 96),
      countZ: clampInt(Math.round(r.width / step), 8, 96),
    });
    const scaleMax = this.fixedMaxLux ?? niceMax(grid.stats.max);
    this.lighting.maxLux.value = scaleMax;
    this.lighting.isolineStep.value = scaleMax / 10;
    this.lastState = {
      stats: grid.stats,
      scaleMax,
      luminaireCount: this.placements.length,
      room: { ...r },
      photometry: this.photometryInfo,
    };
    this.updateExposure();
    this.options.onUpdate?.(this.lastState);
    this.requestRender();
  }

  /**
   * Автоэкспозиция: подбираем так, чтобы пол со средней освещённостью был серым средней яркости.
   * Глаз тоже адаптируется — поэтому 300 лк и 3000 лк на экране выглядят похоже;
   * абсолютные значения смотрите на карте в люксах.
   */
  private updateExposure(): void {
    const average = this.lastState?.stats.average ?? 0;
    const reference = Math.max(average, 1);
    const floorLuminance = (this.room.floorReflectance * reference) / Math.PI;
    this.lighting.exposure.value = (0.3 / floorLuminance) * this.exposureFactor;
    // Немного «отражённого» света, чтобы потолок и тени не были абсолютно чёрными
    this.lighting.ambientLux.value = this.lightOn ? reference * 0.08 : 0;
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value || 0)));
}

/** Освободить GPU-ресурсы (геометрии и материалы) у объекта и его потомков. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => m.dispose());
    }
  });
}
