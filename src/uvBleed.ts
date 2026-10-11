import type { BufferGeometry, Mesh, Object3D } from "three";
import type { SkinViewer } from "skinview3d";

// skinview3d maps every box face onto the exact texel rectangle of its part. On the
// pixels that fall right on the border of a face, interpolation error pushes the
// lookup into the neighbouring region of the skin. Where a part has no outer layer
// that neighbour is often opaque (legacy skins fill the unused areas), so stray
// opaque pixels showed up around the transparent outer boxes, and the outline pass
// turned each one into a bright dot. Pulling the UVs a hair inside the face keeps
// every lookup in its own rectangle.
const SKIN_GRID = 64; // skinview3d lays skins out on a 64x64 grid, whatever their resolution
const INSET = 0.01 / SKIN_GRID; // 1% of a texel of a 64px skin
const ON_GRID = 1e-4;

function insetGeometry(geometry: BufferGeometry): void {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const data = uv.array as Float32Array;
  let changed = false;

  // BoxGeometry: 4 vertices (8 floats) per face
  for (let face = 0; face + 8 <= data.length; face += 8) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < 4; i++) {
      cx += data[face + i * 2];
      cy += data[face + i * 2 + 1];
    }
    cx /= 4;
    cy /= 4;

    for (let i = face; i < face + 8; i++) {
      // Only coordinates still sitting on a texel border are moved, so calling this
      // twice on the same geometry does nothing the second time.
      const onGrid = Math.abs(data[i] * SKIN_GRID - Math.round(data[i] * SKIN_GRID)) < ON_GRID;
      if (!onGrid) continue;
      const centre = (i - face) % 2 === 0 ? cx : cy;
      data[i] += Math.sign(centre - data[i]) * INSET;
      changed = true;
    }
  }
  if (changed) uv.needsUpdate = true;
}

const patchedSkins = new WeakSet<object>();

/**
 * Removes the stray pixels skinview3d draws on the edges of the skin boxes.
 * Safe to call more than once.
 */
export function fixSkinUvBleeding(viewer: SkinViewer): void {
  const player = viewer.playerObject;
  const skin = player.skin as any;
  const materials = new Set([
    skin.layer1Material,
    skin.layer1MaterialBiased,
    skin.layer2Material,
    skin.layer2MaterialBiased,
  ]);

  // The animation regroups the body parts, so the meshes are looked up from the
  // player root rather than from `skin`.
  const apply = () => {
    player.traverse((obj: Object3D) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh && materials.has(mesh.material)) insetGeometry(mesh.geometry);
    });
  };
  apply();

  // Switching between classic and slim arms makes skinview3d rewrite the arm UVs.
  if (!patchedSkins.has(skin) && Array.isArray(skin.modelListeners)) {
    patchedSkins.add(skin);
    skin.modelListeners.push(apply);
  }
}
