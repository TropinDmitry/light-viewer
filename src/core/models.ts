import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * 3D-модели светильников.
 *
 * Договорённость для всех моделей: начало координат — центр светящей поверхности
 * (там же фотометрический центр IES), светильник «смотрит» вниз (−Y), длинная сторона вдоль X (C0).
 * Меш рассеивателя называется `diffuser` — его материал включается/выключается кнопкой «свечение».
 */

export type PlaceholderShape = 'linear' | 'puck' | 'flood';

const DIFFUSER_NAME = 'diffuser';

function bodyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xd9dade, metalness: 0.6, roughness: 0.35 });
}

function darkMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.5, roughness: 0.5 });
}

function diffuserMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9, emissive: 0xfff4e5, emissiveIntensity: 0 });
}

/** Процедурная заглушка, если GLB-модели нет. */
export function createPlaceholder(shape: PlaceholderShape): THREE.Group {
  const group = new THREE.Group();
  group.name = `placeholder-${shape}`;

  if (shape === 'linear') {
    // Линейный светильник 1200 × 70 × 60 мм
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.07), bodyMaterial());
    body.position.y = 0.03 + 0.004;
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.008, 0.06), diffuserMaterial());
    diffuser.position.y = 0.004;
    diffuser.name = DIFFUSER_NAME;
    const capGeometry = new THREE.BoxGeometry(0.01, 0.066, 0.074);
    const capLeft = new THREE.Mesh(capGeometry, darkMaterial());
    capLeft.position.set(-0.6, 0.033, 0);
    const capRight = capLeft.clone();
    capRight.position.x = 0.6;
    group.add(body, diffuser, capLeft, capRight);
  }

  if (shape === 'puck') {
    // Круглый накладной светильник («таблетка») Ø 300 × 50 мм
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.045, 64), bodyMaterial());
    body.position.y = 0.0225 + 0.005;
    const diffuser = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.006, 64), diffuserMaterial());
    diffuser.position.y = 0.003;
    diffuser.name = DIFFUSER_NAME;
    group.add(body, diffuser);
  }

  if (shape === 'flood') {
    // Прожектор 250 × 200 мм с рёбрами радиатора и скобой
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.2), darkMaterial());
    body.position.y = 0.025;
    group.add(body);
    for (let k = 0; k < 9; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.18), darkMaterial());
      fin.position.set(-0.11 + k * 0.0275, 0.0625, 0);
      group.add(fin);
    }
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.005, 0.17), diffuserMaterial());
    glass.position.y = 0.0025;
    glass.name = DIFFUSER_NAME;
    group.add(glass);
    // Скоба-лира
    const bracketMaterial = darkMaterial();
    const sideGeometry = new THREE.BoxGeometry(0.008, 0.12, 0.03);
    const left = new THREE.Mesh(sideGeometry, bracketMaterial);
    left.position.set(-0.135, 0.07, 0);
    const right = left.clone();
    right.position.x = 0.135;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.278, 0.008, 0.03), bracketMaterial);
    top.position.y = 0.13;
    group.add(left, right, top);
  }

  return group;
}

/**
 * Загрузка GLB/GLTF. Поддерживается сжатие meshopt (декодер встроен в three/addons).
 * Draco требует отдельные wasm-файлы декодера, в прототипе не подключён.
 */
export async function loadModel(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  normalizeModel(model);
  return model;
}

/**
 * Приводим модель из CAD к договорённости:
 *  - если модель огромная (> 20 по размеру), считаем, что она в миллиметрах, и уменьшаем в 1000 раз;
 *  - ставим так, чтобы низ модели (светящая поверхность) оказался в начале координат.
 */
export function normalizeModel(model: THREE.Object3D): void {
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > 20) {
    model.scale.multiplyScalar(0.001);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
  }
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
}

/**
 * Найти материалы рассеивателя: меши с именем diffuser / lens / emit, либо материалы,
 * у которых в модели уже задана эмиссия.
 */
export function findDiffuserMaterials(model: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const result: THREE.MeshStandardMaterial[] = [];
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const byName = /diffuser|lens|emit|рассеив/i.test(mesh.name + ' ' + material.name);
      const hasEmission = material.emissive.getHex() !== 0 && material.emissiveMap === null;
      if ((byName || hasEmission) && !result.includes(material)) {
        if (material.emissive.getHex() === 0) material.emissive.set(0xfff4e5);
        result.push(material);
      }
    }
  });
  return result;
}
