import { useEffect, useRef, useState } from 'react';
import {
  drawPolarCurve,
  parseIes,
  Photometry,
  ROOM_PRESETS,
  type LuminaireViewerElement,
  type RoomPresetName,
  type ViewerState,
} from '../../src/index';

/**
 * Демостраница: слева панель настроек, справа сам <luminaire-viewer>.
 * React здесь только управляет атрибутами веб-компонента — вся логика в ядре.
 */

const IES_FILES = [
  { url: 'ies/lambert.ies', title: 'Косинусное (панель), 3600 лм' },
  { url: 'ies/narrow.ies', title: 'Узкое 24°, 2000 лм' },
  { url: 'ies/wide.ies', title: 'Широкое batwing, 6000 лм' },
  { url: 'ies/linear.ies', title: 'Линейное несимметричное, 4000 лм' },
];

const SAMPLE_GLB = 'models/sample-puck.glb';

const SHAPES = [
  { value: 'linear', title: 'Линейный' },
  { value: 'puck', title: '«Таблетка»' },
  { value: 'flood', title: 'Прожектор' },
];

/** Для каждого пресета — подходящий светильник по умолчанию. */
const PRESET_DEFAULTS: Record<RoomPresetName, { ies: string; shape: string }> = {
  studio: { ies: 'ies/linear.ies', shape: 'linear' },
  office: { ies: 'ies/lambert.ies', shape: 'puck' },
  warehouse: { ies: 'ies/narrow.ies', shape: 'flood' },
  street: { ies: 'ies/wide.ies', shape: 'flood' },
};

export function App() {
  const viewerRef = useRef<LuminaireViewerElement>(null);

  // Светильник
  const [shape, setShape] = useState('linear');
  const [modelUrl, setModelUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [iesUrl, setIesUrl] = useState('ies/linear.ies');
  const [iesName, setIesName] = useState('');
  const [lumens, setLumens] = useState('');
  const [glow, setGlow] = useState(true);
  const [light, setLight] = useState(true);
  const [solid, setSolid] = useState(true);

  // Помещение
  const [preset, setPreset] = useState<RoomPresetName>('studio');
  const [mountHeight, setMountHeight] = useState(ROOM_PRESETS.studio.mountHeight);
  const [countX, setCountX] = useState(1);
  const [countZ, setCountZ] = useState(1);
  const [spacingX, setSpacingX] = useState(0);
  const [spacingZ, setSpacingZ] = useState(0);
  const [workplane, setWorkplane] = useState(0);
  const [rotated, setRotated] = useState(false);

  // Вид
  const [view, setView] = useState<'render' | 'lux'>('render');
  const [exposure, setExposure] = useState(1);
  const [maxLux, setMaxLux] = useState('');

  const [state, setState] = useState<ViewerState | null>(null);
  const [error, setError] = useState('');

  // Подписка на события веб-компонента
  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;
    const onUpdate = (e: Event) => {
      setState((e as CustomEvent<ViewerState>).detail);
      setError('');
    };
    const onError = (e: Event) => setError((e as CustomEvent<string>).detail);
    element.addEventListener('lv-update', onUpdate);
    element.addEventListener('lv-error', onError);
    return () => {
      element.removeEventListener('lv-update', onUpdate);
      element.removeEventListener('lv-error', onError);
    };
  }, []);

  function choosePreset(name: RoomPresetName) {
    const p = ROOM_PRESETS[name];
    setPreset(name);
    setMountHeight(p.mountHeight);
    setCountX(p.countX);
    setCountZ(p.countZ);
    setSpacingX(0);
    setSpacingZ(0);
    setWorkplane(p.workplaneHeight);
    setRotated(false);
    setSolid(name === 'studio');
    setView(name === 'studio' ? 'render' : view);
    if (!modelUrl) setShape(PRESET_DEFAULTS[name].shape);
    if (!iesName) setIesUrl(PRESET_DEFAULTS[name].ies);
  }

  // Свои файлы передаём компоненту как blob-ссылки — так же, как обычные URL
  function onIesFile(file: File | undefined) {
    if (!file) return;
    if (iesName) URL.revokeObjectURL(iesUrl);
    setIesUrl(URL.createObjectURL(file));
    setIesName(file.name);
  }

  function onModelFile(file: File | undefined) {
    if (!file) return;
    if (modelName) URL.revokeObjectURL(modelUrl);
    setModelUrl(URL.createObjectURL(file));
    setModelName(file.name);
  }

  function clearModel() {
    if (modelName) URL.revokeObjectURL(modelUrl);
    setModelUrl('');
    setModelName('');
  }

  /** Выбор в списке: либо заглушка (shape), либо адрес GLB-файла. */
  function chooseModel(value: string) {
    clearModel();
    if (value.endsWith('.glb')) setModelUrl(value);
    else setShape(value);
  }


  const isRoom = preset !== 'studio';

  // Атрибуты компонента — те же, что можно написать руками в HTML
  const attributes: Record<string, string> = {
    ies: iesUrl,
    shape,
    preset,
    'mount-height': String(mountHeight),
    'count-x': String(countX),
    'count-z': String(countZ),
    'spacing-x': String(spacingX),
    'spacing-z': String(spacingZ),
    workplane: String(workplane),
    rotated: String(rotated),
    view,
    glow: String(glow),
    light: String(light),
    solid: String(solid),
    exposure: String(exposure),
  };
  if (modelUrl) attributes.model = modelUrl;
  if (lumens) attributes.lumens = lumens;
  if (maxLux) attributes['max-lux'] = maxLux;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Light Viewer</h1>
        <p className="muted">Прототип модуля для сайта: 3D-светильник, свет по IES и карта освещённости.</p>

        <section>
          <h2>Сцена</h2>
          <div className="segmented">
            {(Object.keys(ROOM_PRESETS) as RoomPresetName[]).map((name) => (
              <button key={name} className={preset === name ? 'active' : ''} onClick={() => choosePreset(name)}>
                {ROOM_PRESETS[name].title}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Светильник</h2>
          <label>
            Модель
            <select value={modelName ? '' : modelUrl || shape} onChange={(e) => chooseModel(e.target.value)}>
              {modelName && <option value="">Свой файл: {modelName}</option>}
              {SHAPES.map((s) => (
                <option key={s.value} value={s.value}>
                  Заглушка: {s.title}
                </option>
              ))}
              <option value={SAMPLE_GLB}>GLB-файл: пример (модель в мм)</option>
            </select>
          </label>
          <div className="file-row">
            <label className="file">
              Загрузить GLB…
              <input type="file" accept=".glb,.gltf" onChange={(e) => onModelFile(e.target.files?.[0])} />
            </label>
            {modelName && (
              <span className="chip">
                {modelName} <button onClick={clearModel}>×</button>
              </span>
            )}
          </div>

          <label>
            Фотометрия (IES)
            <select
              value={iesName ? '' : iesUrl}
              onChange={(e) => {
                setIesName('');
                setIesUrl(e.target.value);
              }}
            >
              {iesName && <option value="">Свой файл: {iesName}</option>}
              {IES_FILES.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
          <label className="file">
            Загрузить свой IES…
            <input type="file" accept=".ies,.IES,.txt" onChange={(e) => onIesFile(e.target.files?.[0])} />
          </label>

          <label>
            Световой поток, лм (пусто — как в файле)
            <input type="number" min={0} step={100} value={lumens} onChange={(e) => setLumens(e.target.value)} />
          </label>

          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={glow} onChange={(e) => setGlow(e.target.checked)} /> свечение рассеивателя
            </label>
            <label className="check">
              <input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} /> свет включён
            </label>
            <label className="check">
              <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.target.checked)} /> фотометрическое тело
            </label>
          </div>
        </section>

        <section>
          <h2>{isRoom ? 'Помещение' : 'Подвес'}</h2>
          <Slider label="Высота подвеса, м" value={mountHeight} min={0.5} max={isRoom ? 15 : 6} step={0.1} onChange={setMountHeight} />
          {isRoom && (
            <>
              <div className="pair">
                <NumberField label="Рядов по длине" value={countX} min={1} max={32} onChange={setCountX} />
                <NumberField label="по ширине" value={countZ} min={1} max={32} onChange={setCountZ} />
              </div>
              <div className="pair">
                <NumberField label="Шаг X, м (0 — авто)" value={spacingX} min={0} max={50} step={0.1} onChange={setSpacingX} />
                <NumberField label="Шаг Z, м" value={spacingZ} min={0} max={50} step={0.1} onChange={setSpacingZ} />
              </div>
              <Slider label="Рабочая плоскость, м" value={workplane} min={0} max={1.5} step={0.05} onChange={setWorkplane} />
              <label className="check">
                <input type="checkbox" checked={rotated} onChange={(e) => setRotated(e.target.checked)} /> повернуть светильники на 90°
              </label>
            </>
          )}
        </section>

        <section>
          <h2>Вид</h2>
          <div className="segmented two">
            <button className={view === 'render' ? 'active' : ''} onClick={() => setView('render')}>
              Картинка
            </button>
            <button className={view === 'lux' ? 'active' : ''} onClick={() => setView('lux')}>
              Карта, лк
            </button>
          </div>
          <div className="pair buttons">
            <button onClick={() => viewerRef.current?.viewer?.resetCamera()}>Сбросить камеру</button>
            <button onClick={() => viewerRef.current?.viewer?.topView()}>Вид сверху</button>
          </div>
          <Slider label="Экспозиция картинки" value={exposure} min={0.2} max={4} step={0.1} onChange={setExposure} />
          <label>
            Верх шкалы, лк (пусто — авто)
            <input type="number" min={0} step={50} value={maxLux} onChange={(e) => setMaxLux(e.target.value)} />
          </label>
        </section>
      </aside>

      <main className="main">
        <luminaire-viewer ref={viewerRef} class="viewer" {...attributes} />
        {error && <div className="error">{error}</div>}
        <div className="cards">
          <PhotometryCard state={state} iesUrl={iesUrl} lumens={lumens} />
          <EmbedCard attributes={attributes} hasLocalFiles={!!modelName || !!iesName} />
        </div>
      </main>
    </div>
  );
}

function PhotometryCard({ state, iesUrl, lumens }: { state: ViewerState | null; iesUrl: string; lumens: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Полярная кривая рисуется отдельно от 3D: читаем тот же IES и строим КСС на canvas
  useEffect(() => {
    let cancelled = false;
    fetch(iesUrl)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled || !canvasRef.current) return;
        const photometry = Photometry.fromIes(parseIes(text));
        photometry.setTargetLumens(Number(lumens) || null);
        drawPolarCurve(canvasRef.current, photometry);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [iesUrl, lumens]);

  const p = state?.photometry;
  return (
    <div className="card photometry">
      <canvas ref={canvasRef} className="polar" />
      <div>
        <h3>Фотометрия</h3>
        {p ? (
          <table>
            <tbody>
              <tr><td>Световой поток</td><td>{Math.round(p.flux)} лм</td></tr>
              <tr><td>Макс. сила света</td><td>{Math.round(p.maxIntensity)} кд</td></tr>
              <tr><td>Угол (50%) C0 / C90</td><td>{p.beamC0.toFixed(0)}° / {p.beamC90.toFixed(0)}°</td></tr>
              <tr><td>Артикул</td><td>{p.catalogNumber || '—'}</td></tr>
              <tr><td>Описание</td><td>{p.description || '—'}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">Загрузка…</p>
        )}
        {p && p.warnings.length > 0 && <p className="warn">{p.warnings.join(' ')}</p>}
        <p className="legend-note">
          <span className="dot red" /> C0–C180 (вдоль) <span className="dot blue" /> C90–C270 (поперёк)
        </p>
      </div>
    </div>
  );
}

function EmbedCard({ attributes, hasLocalFiles }: { attributes: Record<string, string>; hasLocalFiles: boolean }) {
  const lines = Object.entries(attributes)
    .filter(([name]) => !(hasLocalFiles && (name === 'model' || name === 'ies')))
    .map(([name, value]) => `  ${name}="${value}"`);
  const code = `<script type="module" src="luminaire-viewer.standalone.js"></script>\n\n<luminaire-viewer\n${lines.join('\n')}\n></luminaire-viewer>`;
  return (
    <div className="card">
      <h3>Как вставить на сайт</h3>
      <p className="muted">Текущие настройки как HTML-тег. Работает в любой CMS — нужен только этот JS-файл.</p>
      <pre>{code}</pre>
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label>
      <span className="row">
        {props.label} <b>{props.value}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
