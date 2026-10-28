import { cssColorAt } from './core/colormap';
import type { PlaceholderShape } from './core/models';
import type { RoomConfig, RoomPresetName } from './core/room';
import { LuminaireViewer, type ViewMode, type ViewerState } from './core/viewer';

/**
 * <luminaire-viewer> — обёртка ядра в стандартный веб-компонент.
 * Работает на любой странице (Битрикс, Tilda, React, Vue — неважно):
 *
 *   <luminaire-viewer ies="/ies/lambert.ies" lumens="3600" shape="linear" preset="office"></luminaire-viewer>
 *
 * Все настройки — атрибуты. Изменили атрибут → картинка обновилась.
 * После каждого пересчёта элемент отправляет событие `lv-update` (detail — статистика),
 * при ошибке — `lv-error` (detail — текст ошибки).
 */

const ATTRIBUTES = [
  'model',
  'shape',
  'ies',
  'lumens',
  'preset',
  'mount-height',
  'count-x',
  'count-z',
  'spacing-x',
  'spacing-z',
  'workplane',
  'rotated',
  'view',
  'glow',
  'light',
  'exposure',
  'max-lux',
  'solid',
] as const;

const STYLE = `
  :host { display: block; position: relative; min-height: 320px; font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; }
  .canvas { position: absolute; inset: 0; }
  .overlay { position: absolute; pointer-events: none; }
  .panel { background: rgba(15, 17, 22, 0.78); border-radius: 8px; padding: 8px 10px; backdrop-filter: blur(4px); }
  .legend { left: 12px; bottom: 12px; display: none; gap: 8px; }
  .legend.visible { display: flex; }
  .bar { width: 14px; height: 160px; border-radius: 3px; }
  .ticks { display: flex; flex-direction: column; justify-content: space-between; height: 160px; font-variant-numeric: tabular-nums; }
  .stats { right: 12px; bottom: 12px; font-variant-numeric: tabular-nums; min-width: 170px; }
  .stats b { font-weight: 600; }
  .note { left: 12px; top: 12px; max-width: 290px; font-size: 12px; color: #ffd27a; display: none; }
  .note.visible { display: block; }
  .tooltip { display: none; transform: translate(12px, -28px); white-space: nowrap; }
  .tooltip.visible { display: block; }
  .status { inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 20px; }
  .status.visible { display: flex; }
  .status.error { color: #ff8a8a; }
`;

export class LuminaireViewerElement extends HTMLElement {
  static observedAttributes = [...ATTRIBUTES];

  /** Ядро — доступно для продвинутого управления из JS. */
  viewer: LuminaireViewer | null = null;
  state: ViewerState | null = null;

  private root: ShadowRoot;
  private canvasHost: HTMLDivElement;
  private legend: HTMLDivElement;
  private stats: HTMLDivElement;
  private note: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private status: HTMLDivElement;
  private pendingLoads = 0;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${STYLE}</style>
      <div class="canvas"></div>
      <div class="overlay panel note">Карта показывает только прямой свет от светильников. Отражения от стен, потолка и мебели не учитываются — реальная освещённость будет выше. Это приближение, не замена расчёта в DIALux.</div>
      <div class="overlay panel legend"><div class="bar"></div><div class="ticks"></div></div>
      <div class="overlay panel stats"></div>
      <div class="overlay panel tooltip"></div>
      <div class="overlay status"></div>
    `;
    this.canvasHost = this.root.querySelector('.canvas')!;
    this.legend = this.root.querySelector('.legend')!;
    this.stats = this.root.querySelector('.stats')!;
    this.note = this.root.querySelector('.note')!;
    this.tooltip = this.root.querySelector('.tooltip')!;
    this.status = this.root.querySelector('.status')!;

    this.canvasHost.addEventListener('pointermove', (e) => this.showTooltip(e));
    this.canvasHost.addEventListener('pointerleave', () => this.tooltip.classList.remove('visible'));
  }

  connectedCallback(): void {
    if (this.viewer) return;
    try {
      this.viewer = new LuminaireViewer(this.canvasHost, { onUpdate: (s) => this.handleUpdate(s) });
    } catch (error) {
      this.showError(`Не удалось запустить WebGL: ${errorText(error)}`);
      return;
    }
    // Сначала помещение (оно задаёт расстановку), потом всё остальное
    this.applyRoomAttributes();
    for (const name of ATTRIBUTES) {
      if (!isRoomAttribute(name)) this.applyAttribute(name);
    }
  }

  disconnectedCallback(): void {
    this.viewer?.dispose();
    this.viewer = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.viewer || oldValue === newValue) return;
    if (isRoomAttribute(name)) this.applyRoomAttributes(name === 'preset');
    else this.applyAttribute(name);
  }

  /** Задать IES из текста — например, из файла, выбранного пользователем. */
  setIesText(text: string): void {
    this.run(() => this.viewer?.setIesText(text));
  }

  /** Показать GLB из выбранного пользователем файла. */
  async loadModelFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      await this.runAsync(() => this.viewer!.loadModel(url));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------------------------------------------------------------------------

  private applyAttribute(name: string): void {
    const viewer = this.viewer!;
    switch (name) {
      case 'model':
      case 'shape': {
        const model = this.getAttribute('model');
        if (model) void this.runAsync(() => viewer.loadModel(model));
        else viewer.setPlaceholder((this.getAttribute('shape') as PlaceholderShape) || 'linear');
        break;
      }
      case 'ies': {
        const ies = this.getAttribute('ies');
        if (ies) void this.runAsync(() => viewer.loadIes(ies));
        break;
      }
      case 'lumens':
        viewer.setLumens(this.numberAttr('lumens'));
        break;
      case 'view':
        viewer.setView((this.getAttribute('view') as ViewMode) || 'render');
        this.updateOverlay();
        break;
      case 'glow':
        viewer.setGlow(this.boolAttr('glow', true));
        break;
      case 'light':
        viewer.setLightOn(this.boolAttr('light', true));
        break;
      case 'exposure':
        viewer.setExposure(this.numberAttr('exposure') ?? 1);
        break;
      case 'max-lux':
        viewer.setMaxLux(this.numberAttr('max-lux'));
        break;
      case 'solid':
        viewer.setShowSolid(this.boolAttr('solid', false));
        break;
    }
  }

  /** Атрибуты помещения применяем пачкой: пресет + переопределения. */
  private applyRoomAttributes(presetChanged = true): void {
    const viewer = this.viewer!;
    const changes: Partial<RoomConfig> = {};
    if (presetChanged) {
      const preset = (this.getAttribute('preset') as RoomPresetName) || 'studio';
      viewer.setPreset(preset);
    }
    const mount = this.numberAttr('mount-height');
    const countX = this.numberAttr('count-x');
    const countZ = this.numberAttr('count-z');
    const spacingX = this.numberAttr('spacing-x');
    const spacingZ = this.numberAttr('spacing-z');
    const workplane = this.numberAttr('workplane');
    if (mount !== null) changes.mountHeight = mount;
    if (countX !== null) changes.countX = countX;
    if (countZ !== null) changes.countZ = countZ;
    if (spacingX !== null) changes.spacingX = spacingX;
    if (spacingZ !== null) changes.spacingZ = spacingZ;
    if (workplane !== null) changes.workplaneHeight = workplane;
    if (this.hasAttribute('rotated')) changes.rotated = this.boolAttr('rotated', false);
    if (Object.keys(changes).length > 0) viewer.setRoom(changes);
  }

  private handleUpdate(state: ViewerState): void {
    this.state = state;
    this.updateOverlay();
    this.dispatchEvent(new CustomEvent('lv-update', { detail: state }));
  }

  private updateOverlay(): void {
    const state = this.state;
    const isLux = this.getAttribute('view') === 'lux';
    this.legend.classList.toggle('visible', isLux && !!state);
    this.note.classList.toggle('visible', isLux);
    if (!state) {
      this.stats.innerHTML = 'Загрузите IES-файл, чтобы увидеть расчёт';
      return;
    }

    // Легенда: градиент той же шкалы, что в шейдере, сверху — максимум
    const stops: string[] = [];
    for (let k = 0; k <= 10; k++) stops.push(`${cssColorAt(1 - k / 10)} ${k * 10}%`);
    (this.legend.querySelector('.bar') as HTMLElement).style.background = `linear-gradient(${stops.join(', ')})`;
    const ticks: string[] = [];
    for (let k = 5; k >= 0; k--) ticks.push(`<span>${formatTick((state.scaleMax * k) / 5)}</span>`);
    this.legend.querySelector('.ticks')!.innerHTML = ticks.join('');

    const s = state.stats;
    const p = state.photometry;
    this.stats.innerHTML = `
      <div>Освещённость на высоте ${state.room.workplaneHeight} м, лк</div>
      <div>мин <b>${formatLux(s.min)}</b> · ср <b>${formatLux(s.average)}</b> · макс <b>${formatLux(s.max)}</b></div>
      <div>Равномерность U0 = <b>${s.uniformity.toFixed(2)}</b></div>
      <div>Светильников: ${state.luminaireCount}${p ? ` · ${Math.round(p.flux)} лм каждый` : ''}</div>
      ${isLux ? '' : '<div style="opacity:.7">Только прямой свет (без отражений)</div>'}
    `;
  }

  private showTooltip(event: PointerEvent): void {
    if (!this.viewer || this.getAttribute('view') !== 'lux') return;
    const hit = this.viewer.luxAtScreen(event.clientX, event.clientY);
    if (!hit) {
      this.tooltip.classList.remove('visible');
      return;
    }
    const rect = this.getBoundingClientRect();
    this.tooltip.style.left = `${event.clientX - rect.left}px`;
    this.tooltip.style.top = `${event.clientY - rect.top}px`;
    this.tooltip.textContent = `${formatLux(hit.lux)} лк  (x ${hit.x.toFixed(1)}, z ${hit.z.toFixed(1)} м)`;
    this.tooltip.classList.add('visible');
  }

  private run(action: () => void): void {
    try {
      action();
      this.hideStatus();
    } catch (error) {
      this.showError(errorText(error));
    }
  }

  /** Асинхронная загрузка с индикатором «Загрузка…», пока идёт хотя бы одна загрузка. */
  private async runAsync(action: () => Promise<void>): Promise<void> {
    this.pendingLoads++;
    this.status.className = 'overlay status visible';
    this.status.textContent = 'Загрузка…';
    try {
      await action();
      this.pendingLoads--;
      if (this.pendingLoads === 0) this.hideStatus();
    } catch (error) {
      this.pendingLoads--;
      this.showError(errorText(error));
    }
  }

  private showError(message: string): void {
    this.status.className = 'overlay status visible error';
    this.status.textContent = message;
    this.dispatchEvent(new CustomEvent('lv-error', { detail: message }));
  }

  private hideStatus(): void {
    this.status.className = 'overlay status';
    this.status.textContent = '';
  }

  private numberAttr(name: string): number | null {
    const raw = this.getAttribute(name);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  /** Нет атрибута → значение по умолчанию; "false", "0", "off" → false; иначе true. */
  private boolAttr(name: string, fallback: boolean): boolean {
    const raw = this.getAttribute(name);
    if (raw === null) return fallback;
    return !['false', '0', 'off', 'no'].includes(raw.trim().toLowerCase());
  }
}

function isRoomAttribute(name: string): boolean {
  return ['preset', 'mount-height', 'count-x', 'count-z', 'spacing-x', 'spacing-z', 'workplane', 'rotated'].includes(name);
}

function formatLux(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value >= 10 ? 0 : 1);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Регистрирует элемент под именем luminaire-viewer (повторный вызов безопасен). */
export function defineLuminaireViewer(tagName = 'luminaire-viewer'): void {
  if (!customElements.get(tagName)) customElements.define(tagName, LuminaireViewerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'luminaire-viewer': LuminaireViewerElement;
  }
}
