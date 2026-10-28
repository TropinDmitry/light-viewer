import * as THREE from 'three';
import { colormapPixels } from './colormap';
import type { LuminairePlacement } from './illuminance';
import type { Photometry } from './photometry';

/**
 * Материал для пола, стен и рабочей плоскости, который сам считает освещённость
 * от IES-светильников в каждом пикселе — по той же формуле, что и illuminance.ts:
 *
 *     E = Σ I(γ, C) · cos(угла падения) / d²
 *
 * Почему не стандартные источники света Three.js:
 *  - SpotLight/PointLight не умеют произвольное распределение силы света;
 *  - IESSpotLight есть только для WebGPURenderer и берёт одну C-плоскость (см. docs/REPORT.md);
 *  - так картинка и карта в люксах получаются из одних и тех же чисел.
 *
 * Данные передаются в шейдер текстурами:
 *  - uIes — таблица силы света: по горизонтали γ 0…180°, по вертикали C 0…360°, нормирована на максимум;
 *  - uLuminaires — по одному пикселю на светильник: RGB = позиция, A = поворот вокруг Y.
 */

export const MAX_LUMINAIRES = 1024;

export type SurfaceMode = 'realistic' | 'falseColor';

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  #define PI 3.141592653589793
  #define MAX_LUMINAIRES ${MAX_LUMINAIRES}

  uniform sampler2D uIes;
  uniform vec2 uIesSize;        // число узлов таблицы по γ и по C
  uniform float uIesMax;        // кд, соответствует значению 1.0 в таблице
  uniform sampler2D uLuminaires;
  uniform int uLuminaireCount;
  uniform float uNormalSign;    // −1 для коробки комнаты: нормали BoxGeometry смотрят наружу

  uniform int uMode;            // 0 — «как выглядит», 1 — карта в люксах
  uniform vec3 uAlbedo;         // цвет поверхности × коэффициент отражения
  uniform float uExposure;      // перевод яркости (кд/м²) в значения для экрана
  uniform float uAmbientLux;    // условная добавка «отражённого» света, только для картинки
  uniform sampler2D uColormap;
  uniform float uMaxLux;        // верх цветовой шкалы
  uniform float uIsolineStep;   // шаг изолиний, лк (0 — без изолиний)

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // Сила света светильника в направлении v (вектор от светильника к точке), кд.
  float intensityToward(vec3 v, float dist, float rotationY) {
    // γ — угол от надира (−Y)
    float gamma = acos(clamp(-v.y / dist, -1.0, 1.0));
    // C — азимут в системе светильника: снимаем поворот, считаем против часовой стрелки сверху
    float localX = v.x * cos(rotationY) - v.z * sin(rotationY);
    float localZ = v.x * sin(rotationY) + v.z * cos(rotationY);
    float c = atan(-localZ, localX);
    if (c < 0.0) c += 2.0 * PI;
    // Переводим углы в координаты текстуры так, чтобы узлы попадали в центры текселей
    vec2 uv = (vec2(gamma / PI, c / (2.0 * PI)) * (uIesSize - 1.0) + 0.5) / uIesSize;
    return texture(uIes, uv).r * uIesMax;
  }

  float illuminance(vec3 point, vec3 normal) {
    float total = 0.0;
    for (int i = 0; i < MAX_LUMINAIRES; i++) {
      if (i >= uLuminaireCount) break;
      vec4 luminaire = texelFetch(uLuminaires, ivec2(i, 0), 0);
      vec3 v = point - luminaire.xyz;
      float distSq = dot(v, v);
      float dist = sqrt(distSq);
      float cosIncidence = -dot(normal, v) / dist;
      if (cosIncidence <= 0.0) continue;
      total += intensityToward(v, dist, luminaire.w) * cosIncidence / distSq;
    }
    return total;
  }

  void main() {
    vec3 normal = normalize(vWorldNormal) * uNormalSign;
    float lux = illuminance(vWorldPosition, normal);

    if (uMode == 1) {
      vec3 color = texture(uColormap, vec2(clamp(lux / uMaxLux, 0.0, 1.0), 0.5)).rgb;
      if (uIsolineStep > 0.0) {
        // Тонкие линии равной освещённости: там, где lux кратно шагу
        float x = lux / uIsolineStep;
        float line = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-4);
        color = mix(color * 0.35, color, clamp(line, 0.0, 1.0));
      }
      gl_FragColor = vec4(color, 1.0);
    } else {
      // Яркость диффузной поверхности L = ρ·E / π (кд/м²), затем экспозиция и тонмаппинг
      vec3 luminance = uAlbedo * (lux + uAmbientLux) / PI;
      gl_FragColor = vec4(luminance * uExposure, 1.0);
      #include <tonemapping_fragment>
    }
    #include <colorspace_fragment>
  }
`;

/** Общие для всех поверхностей данные: таблица IES, положения светильников, шкала. */
export class LightingData {
  readonly iesTexture: { value: THREE.DataTexture };
  readonly iesSize = { value: new THREE.Vector2(2, 2) };
  readonly iesMax = { value: 0 };
  readonly luminaireTexture: { value: THREE.DataTexture };
  readonly luminaireCount = { value: 0 };
  readonly colormap: { value: THREE.DataTexture };
  readonly maxLux = { value: 500 };
  readonly isolineStep = { value: 0 };
  readonly exposure = { value: 1 };
  readonly ambientLux = { value: 0 };

  constructor() {
    this.iesTexture = { value: makeIesTexture(new Float32Array(4), 2, 2) };
    this.luminaireTexture = { value: makeLuminaireTexture([]) };
    const colormap = new THREE.DataTexture(colormapPixels(256), 256, 1, THREE.RGBAFormat);
    colormap.magFilter = THREE.LinearFilter;
    colormap.minFilter = THREE.LinearFilter;
    colormap.colorSpace = THREE.SRGBColorSpace;
    colormap.needsUpdate = true;
    this.colormap = { value: colormap };
  }

  setPhotometry(photometry: Photometry): void {
    const lut = photometry.toLut();
    this.iesTexture.value.dispose();
    this.iesTexture.value = makeIesTexture(lut.data, lut.nG, lut.nC);
    this.iesSize.value.set(lut.nG, lut.nC);
    this.iesMax.value = lut.max * photometry.scale;
  }

  /** lightOn = false — светильники выключены (считаем, что их ноль). */
  setLuminaires(luminaires: LuminairePlacement[], lightOn: boolean): void {
    const list = luminaires.slice(0, MAX_LUMINAIRES);
    this.luminaireTexture.value.dispose();
    this.luminaireTexture.value = makeLuminaireTexture(list);
    this.luminaireCount.value = lightOn ? list.length : 0;
  }

  dispose(): void {
    this.iesTexture.value.dispose();
    this.luminaireTexture.value.dispose();
    this.colormap.value.dispose();
  }
}

export function createSurfaceMaterial(
  data: LightingData,
  options: { mode: SurfaceMode; albedo: THREE.Color; normalSign?: number; side?: THREE.Side },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: options.side ?? THREE.FrontSide,
    // Тонмаппинг нужен только для «реалистичной» картинки; карта в люксах выводится как есть.
    toneMapped: options.mode === 'realistic',
    uniforms: {
      uIes: data.iesTexture,
      uIesSize: data.iesSize,
      uIesMax: data.iesMax,
      uLuminaires: data.luminaireTexture,
      uLuminaireCount: data.luminaireCount,
      uNormalSign: { value: options.normalSign ?? 1 },
      uMode: { value: options.mode === 'falseColor' ? 1 : 0 },
      uAlbedo: { value: options.albedo },
      uExposure: data.exposure,
      uAmbientLux: data.ambientLux,
      uColormap: data.colormap,
      uMaxLux: data.maxLux,
      uIsolineStep: data.isolineStep,
    },
  });
}

function makeIesTexture(values: Float32Array, width: number, height: number): THREE.DataTexture {
  // Half float: линейная фильтрация для него гарантирована в WebGL2, в отличие от float32.
  const half = new Uint16Array(values.length);
  for (let k = 0; k < values.length; k++) half[k] = THREE.DataUtils.toHalfFloat(values[k]);
  const texture = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function makeLuminaireTexture(luminaires: LuminairePlacement[]): THREE.DataTexture {
  const count = Math.max(1, luminaires.length);
  const data = new Float32Array(count * 4);
  luminaires.forEach((lum, i) => {
    data[i * 4] = lum.position[0];
    data[i * 4 + 1] = lum.position[1];
    data[i * 4 + 2] = lum.position[2];
    data[i * 4 + 3] = lum.rotationY ?? 0;
  });
  const texture = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
