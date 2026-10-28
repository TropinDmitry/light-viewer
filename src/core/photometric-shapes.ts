import * as THREE from 'three';
import type { Photometry } from './photometry';

const DEG = Math.PI / 180;

/**
 * Направление (γ, C) → единичный вектор в системе светильника.
 * Обратное к формулам в illuminance.ts: γ от −Y, C против часовой стрелки сверху (от +X к −Z).
 */
function directionOf(gammaDeg: number, cDeg: number): THREE.Vector3 {
  const s = Math.sin(gammaDeg * DEG);
  return new THREE.Vector3(s * Math.cos(cDeg * DEG), -Math.cos(gammaDeg * DEG), -s * Math.sin(cDeg * DEG));
}

/**
 * Фотометрическое тело: поверхность, у которой расстояние от центра пропорционально силе света.
 * Наглядно показывает, куда и как сильно светит светильник.
 */
export function createPhotometricSolid(photometry: Photometry, radius: number): THREE.Mesh {
  const surface = buildSolidGeometry(photometry, radius, 3, 7.5);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffb340,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(surface, material);

  // Редкая сетка линий поверх (меридианы через 30°, параллели через 15°), чтобы читалась форма
  const coarse = buildSolidGeometry(photometry, radius, 15, 30);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(coarse),
    new THREE.LineBasicMaterial({ color: 0xffc870, transparent: true, opacity: 0.6 }),
  );
  coarse.dispose();
  mesh.add(wire);
  mesh.name = 'photometric-solid';
  return mesh;
}

/** Сетка точек по γ и C, радиус каждой точки = I / Imax · radius. */
function buildSolidGeometry(photometry: Photometry, radius: number, stepG: number, stepC: number): THREE.BufferGeometry {
  const rows = 180 / stepG + 1;
  const cols = 360 / stepC + 1;
  const max = photometry.maxIntensity || 1;

  const positions: number[] = [];
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) {
      const g = i * stepG;
      const c = j * stepC;
      const r = (photometry.intensity(g, c) / max) * radius;
      const p = directionOf(g, c).multiplyScalar(r);
      positions.push(p.x, p.y, p.z);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < cols - 1; j++) {
    for (let i = 0; i < rows - 1; i++) {
      const a = j * rows + i;
      const b = (j + 1) * rows + i;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Полярная кривая силы света (КСС) — как в каталогах: 0° внизу, две плоскости C0–C180 и C90–C270.
 */
export function drawPolarCurve(canvas: HTMLCanvasElement, photometry: Photometry): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 240;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 18;
  const max = photometry.maxIntensity || 1;

  // Сетка: окружности и лучи через 30°
  ctx.strokeStyle = 'rgba(128,128,128,0.35)';
  ctx.fillStyle = 'rgba(128,128,128,0.9)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * k) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < 360; a += 30) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius * Math.sin(a * DEG), cy + radius * Math.cos(a * DEG));
    ctx.stroke();
  }
  ctx.fillText(`${Math.round(max)} кд`, cx + 4, cy + radius - 2);
  ctx.fillText('0°', cx - 6, cy + radius + 13);
  ctx.fillText('90°', cx + radius + 2, cy + 3);

  // Каждая плоскость: правая половина — C, левая — C+180. γ отсчитывается от низа.
  const plane = (c: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let g = -180; g <= 180; g += 1) {
      const cc = g >= 0 ? c : c + 180;
      const r = (photometry.intensity(Math.abs(g), cc) / max) * radius;
      const x = cx + r * Math.sin(g * DEG);
      const y = cy + r * Math.cos(g * DEG);
      if (g === -180) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  plane(0, '#e5484d');
  plane(90, '#3e8ef7');
}
