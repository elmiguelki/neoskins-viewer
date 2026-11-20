/**
 * NEOCapes GIF: renders a skin from behind with the viewer's own animations and exports a
 * looping GIF that showcases the cape (or the same texture as an elytra).
 *
 * The viewer's render loop and the GIF texture timers are bypassed: every frame sets the
 * animation time and the texture frame by hand, so the export is exact and loops cleanly.
 */
import { SkinViewer } from "skinview3d";
import type { Texture } from "three";
import { GIFEncoder, quantize } from "gifenc";
import animationFile from "../../src/animations/model.animation.json";
import { IDLE_ANIMATION, RANDOM_ANIMATIONS, setupSkinAnimation } from "../../src/animation";
import { enhanceSkinViewer } from "../../src/outline";
import { fixSkinUvBleeding } from "../../src/uvBleed";
import { buildTexturesFromDecoded, decodeAndComposeGif, hasGifSignature } from "../../src/gifTextures";
import { NeoSkinsClient, type NeoCape } from "../../src/client";

type Equipment = "cape" | "elytra";
type ModelChoice = "auto" | "classic" | "slim";

/** Frames of an animated texture, with their delays in ms. */
interface TextureTrack {
  textures: Texture[];
  delays: number[];
  total: number;
}

const SUPERSAMPLE = 2;
const ANIMATIONS = animationFile.animations as Record<string, { animation_length: number }>;
const GESTURES: readonly string[] = RANDOM_ANIMATIONS;
const LABELS: Record<string, string> = {
  idle_loop: "Reposo",
  look: "Mirar",
  scratch: "Rascarse",
  salute: "Saludo",
  hi: "Saludar",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- state

/** One block of the sequence: an animation played `times` times in a row. */
interface SequenceItem {
  name: string;
  times: number;
}

const DEFAULT_ITEMS: SequenceItem[] = [
  { name: IDLE_ANIMATION, times: 1 },
  { name: "hi", times: 1 },
  { name: IDLE_ANIMATION, times: 1 },
  { name: "scratch", times: 1 },
];

const state = {
  items: DEFAULT_ITEMS.map((i) => ({ ...i })),
  /** `items` expanded, one entry per play. Rebuilt by sequenceChanged(). */
  sequence: [] as string[],
  equipment: "cape" as Equipment,
  model: "auto" as ModelChoice,
  angleDeg: 0,
  pitchDeg: 0,
  /** Outward angle of each elytra wing, in degrees: 15 is the folded rest pose. */
  wingDeg: 40,
  zoom: 0.9,
  width: 300,
  height: 400,
  fps: 25,
  transparent: false,
  background: "#1e1f24",
  outline: true,
  globalPalette: true,
  autoFit: true,
  exporting: false,
  skinBytes: null as ArrayBuffer | null,
  capeBytes: null as ArrayBuffer | null,
  skinTrack: null as TextureTrack | null,
  capeTrack: null as TextureTrack | null,
  name: "neocape",
};

// ---------------------------------------------------------------- viewer

const viewer = new SkinViewer({
  width: state.width,
  height: state.height,
  renderPaused: true,
  preserveDrawingBuffer: true,
});

const controller = setupSkinAnimation(viewer, { rotationY: Math.PI });
// Only the pose evaluation is used: no random gestures, no clock.
controller.destroy();
const anim = controller.animation as any;
anim.clock = { getDelta: () => 0 };

// setupSkinAnimation hangs the cape from the body so it follows the torso; do the same with the elytra.
{
  const player = viewer.playerObject;
  player.skin.body.add(player.elytra);
  player.elytra.position.set(0, 6, -2);
  player.elytra.rotation.set(0, 0, 0);
}

// Wing angles of skinview3d's elytra: the rest pose, and the spread pose of its flying animation
// (wings horizontal, which from behind shows them edge-on, so the slider stops well before it).
const WING_FOLDED = { x: 0.2617994, z: 0.2617994 };
const WING_SPREAD = { x: 0.34906584, z: Math.PI / 2 };

function applyWings(): void {
  const z = (state.wingDeg * Math.PI) / 180;
  const s = (z - WING_FOLDED.z) / (WING_SPREAD.z - WING_FOLDED.z);
  const elytra = viewer.playerObject.elytra;
  elytra.leftWing.rotation.x = WING_FOLDED.x + s * (WING_SPREAD.x - WING_FOLDED.x);
  elytra.leftWing.rotation.z = z;
  elytra.updateRightWing();
}

fixSkinUvBleeding(viewer);
const enhancement = enhanceSkinViewer(viewer, { pixelRatio: SUPERSAMPLE, enabled: state.outline });
viewer.fxaaPass.enabled = true;
viewer.controls.enabled = false;

function applyCamera(): void {
  // XYZ order: the model turns around its own vertical axis first, then tilts towards the
  // camera, which reads as looking at it from above (positive) or below (negative).
  const rad = Math.PI / 180;
  viewer.playerWrapper.rotation.set(state.pitchDeg * rad, Math.PI + state.angleDeg * rad, 0, "XYZ");
  viewer.zoom = state.zoom;
}

// ---------------------------------------------------------------- timeline

const lengthOf = (name: string) => ANIMATIONS[name]?.animation_length ?? 0;
const totalDuration = () => state.sequence.reduce((sum, name) => sum + lengthOf(name), 0);

function segmentAt(t: number): { name: string; local: number } {
  let start = 0;
  for (const name of state.sequence) {
    const len = lengthOf(name);
    if (t < start + len) return { name, local: t - start };
    start += len;
  }
  const last = state.sequence[state.sequence.length - 1] ?? IDLE_ANIMATION;
  return { name: last, local: lengthOf(last) };
}

// ---------------------------------------------------------------- loop fitting

/**
 * How the GIF maps onto the sequence. With auto-fit, the GIF lasts a whole number of cycles of
 * the animated textures, so they loop seamlessly too. To get there the sequence may repeat,
 * extra idle loops may be appended at the end, and the body animation plays slightly faster or
 * slower to fill the exact time.
 */
interface Timing {
  /** GIF length in seconds. */
  duration: number;
  /** One pass of the sequence, in seconds of animation time. */
  bodyLength: number;
  repeats: number;
  /** Idle loops played after the last pass of the sequence. */
  extraIdles: number;
  /** Animation seconds per GIF second. */
  speed: number;
  /** Texture cycle the GIF is fitted to, in ms, and how many times it plays. */
  unitMs: number | null;
  cycles: number;
  /** Skin and cape cycles have no common multiple short enough; only the cape is fitted. */
  skinIgnored: boolean;
}

/** Largest speed change accepted before looking further (more passes, more idles). */
const MAX_STRETCH = 0.08;
const MAX_REPEATS = 6;
const MAX_EXTRA_IDLES = 8;
const MAX_LOOP_MS = 60_000;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function fitUnit(): { unit: number | null; skinIgnored: boolean } {
  const cape = state.capeTrack ? Math.round(state.capeTrack.total) : 0;
  const skin = state.skinTrack ? Math.round(state.skinTrack.total) : 0;
  if (cape && skin) {
    const lcm = (cape / gcd(cape, skin)) * skin;
    return lcm <= MAX_LOOP_MS ? { unit: lcm, skinIgnored: false } : { unit: cape, skinIgnored: true };
  }
  return { unit: cape || skin || null, skinIgnored: false };
}

function computeTiming(): Timing {
  const body = totalDuration();
  const plain: Timing = {
    duration: body, bodyLength: body, repeats: 1, extraIdles: 0, speed: 1, unitMs: null, cycles: 0, skinIgnored: false,
  };
  if (!state.autoFit || body <= 0) return plain;
  const { unit, skinIgnored } = fitUnit();
  if (!unit) return plain;

  // Try every mix of sequence passes and trailing idle loops, take the closest whole number of
  // texture cycles for each, and keep the cheapest: short GIFs, little change of speed.
  const unitS = unit / 1000;
  const idle = lengthOf(IDLE_ANIMATION);
  const maxS = Math.max(MAX_LOOP_MS / 1000, unitS);
  type Candidate = { repeats: number; extraIdles: number; cycles: number; err: number; cost: number };
  let best: Candidate | null = null;
  let closest: Candidate | null = null;
  for (let repeats = 1; repeats <= MAX_REPEATS; repeats++) {
    for (let extraIdles = 0; extraIdles <= MAX_EXTRA_IDLES; extraIdles++) {
      const raw = repeats * body + extraIdles * idle;
      const cycles = Math.max(1, Math.round(raw / unitS));
      if (cycles * unitS > maxS && (repeats > 1 || extraIdles > 0)) continue;
      const err = Math.abs((cycles * unitS) / raw - 1);
      const c: Candidate = { repeats, extraIdles, cycles, err, cost: cycles * unitS * (1 + 4 * err) };
      if (!closest || err < closest.err) closest = c;
      if (err <= MAX_STRETCH && (!best || c.cost < best.cost)) best = c;
    }
  }
  const pick = best ?? closest!;
  const duration = pick.cycles * unitS;
  const raw = pick.repeats * body + pick.extraIdles * idle;
  return {
    duration,
    bodyLength: body,
    repeats: pick.repeats,
    extraIdles: pick.extraIdles,
    speed: raw / duration,
    unitMs: unit,
    cycles: pick.cycles,
    skinIgnored,
  };
}

let timing = computeTiming();

function trackTexture(track: TextureTrack, t: number): Texture {
  let ms = (t * 1000) % track.total;
  for (let i = 0; i < track.delays.length; i++) {
    if (ms < track.delays[i]) return track.textures[i];
    ms -= track.delays[i];
  }
  return track.textures[track.textures.length - 1];
}

/**
 * Pose at GIF time `t`: the sequence `repeats` times, then the extra idle loops.
 * `progress` is the position within the sequence (1 during the extra idles), for the playhead.
 */
function poseAt(t: number): { name: string; local: number; progress: number } {
  const body = timing.bodyLength;
  if (body <= 0) return { name: IDLE_ANIMATION, local: 0, progress: 0 };
  const idle = lengthOf(IDLE_ANIMATION);
  const raw = timing.repeats * body + timing.extraIdles * idle;
  const tau = (t * timing.speed) % raw;
  if (tau < timing.repeats * body) {
    const inPass = tau % body;
    return { ...segmentAt(inPass), progress: inPass / body };
  }
  return { name: IDLE_ANIMATION, local: (tau - timing.repeats * body) % idle, progress: 1 };
}

/** Renders GIF time `t` (seconds): the body follows the fitted timing, textures run at real speed. */
function renderAt(t: number): void {
  const { name, local } = poseAt(t);
  anim.animationName = name;
  anim._progress = local;
  anim.paused = false;
  anim.animate(viewer.playerObject);
  applyWings();

  const player = viewer.playerObject as any;
  if (state.skinTrack) {
    const tex = trackTexture(state.skinTrack, t);
    const skin = player.skin;
    for (const mat of [skin.layer1Material, skin.layer1MaterialBiased, skin.layer2Material, skin.layer2MaterialBiased]) {
      if (mat) mat.map = tex;
    }
  }
  if (state.capeTrack) {
    const tex = trackTexture(state.capeTrack, t);
    if (player.cape.map !== tex) player.cape.map = tex;
    if (player.elytra.map !== tex) player.elytra.map = tex;
  }
  viewer.render();
}

/** Draws the last render, downsampled to the output size, on the given 2D context. */
function composite(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!state.transparent) {
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(viewer.canvas, 0, 0, width, height);
}

// ---------------------------------------------------------------- textures

function trackFrom(prepared: ReturnType<typeof buildTexturesFromDecoded>): TextureTrack {
  const delays = prepared.frames.map((f) => f.delay);
  return {
    textures: prepared.frames.map((f) => f.texture),
    delays,
    total: delays.reduce((a, b) => a + b, 0),
  };
}

function disposeTrack(track: TextureTrack | null): void {
  track?.textures.forEach((tex) => tex.dispose());
}

function bytesToImage(bytes: ArrayBuffer): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes]));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("La imagen no se puede leer."));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url)) as Promise<HTMLImageElement>;
}

/** Decodes an animated GIF, or returns null for anything else (or a one-frame GIF). */
async function decodeAnimated(bytes: ArrayBuffer, capeLayout: boolean): Promise<TextureTrack | null> {
  if (!hasGifSignature(bytes)) return null;
  const decoded = await decodeAndComposeGif(bytes);
  if (!decoded || decoded.frames.length <= 1) return null;
  return trackFrom(buildTexturesFromDecoded(decoded, viewer, capeLayout));
}

const viewerModel = (m: ModelChoice) => (m === "slim" ? "slim" : m === "classic" ? "default" : "auto-detect");

async function applySkin(): Promise<void> {
  disposeTrack(state.skinTrack);
  state.skinTrack = null;
  const bytes = state.skinBytes;
  if (!bytes) {
    viewer.loadSkin(null);
    return;
  }
  const track = await decodeAnimated(bytes, false);
  if (track) {
    viewer.loadSkin(track.textures[0].image as HTMLCanvasElement, { model: viewerModel(state.model) });
    state.skinTrack = track;
  } else {
    viewer.loadSkin(await bytesToImage(bytes), { model: viewerModel(state.model) });
  }
}

async function applyCape(): Promise<void> {
  disposeTrack(state.capeTrack);
  state.capeTrack = null;
  const bytes = state.capeBytes;
  if (!bytes) {
    viewer.loadCape(null);
    return;
  }
  const track = await decodeAnimated(bytes, true);
  if (track) {
    viewer.loadCape(track.textures[0].image as HTMLCanvasElement, { backEquipment: state.equipment });
    state.capeTrack = track;
    return;
  }
  const img = await bytesToImage(bytes);
  // The server accepts square capes and keeps the cape in their top half.
  if (img.width === img.height && img.width >= 64) {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height / 2;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    viewer.loadCape(canvas, { backEquipment: state.equipment });
  } else {
    viewer.loadCape(img, { backEquipment: state.equipment });
  }
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return res.arrayBuffer();
}

// ---------------------------------------------------------------- UI: status and warnings

function setStatus(text: string, isError = false): void {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

const fmt = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

function refreshWarnings(): void {
  const T = timing.duration * 1000;
  const frameMs = 1000 / state.fps;
  const notes: string[] = [];

  const info = $("fit-info");
  info.hidden = timing.unitMs === null;
  if (timing.unitMs !== null) {
    const what = state.capeTrack && state.skinTrack && !timing.skinIgnored
      ? "la skin y la capa"
      : state.capeTrack ? (state.equipment === "elytra" ? "la élitra" : "la capa") : "la skin";
    const parts = [
      `Ajustado a ${fmt(timing.duration)} s: ${what} da ` +
        `${timing.cycles === 1 ? "1 vuelta exacta" : `${timing.cycles} vueltas exactas`} de ${fmt(timing.unitMs / 1000)} s`,
    ];
    if (timing.repeats > 1) parts.push(`la secuencia se repite ×${timing.repeats}`);
    if (timing.extraIdles > 0) {
      parts.push(`${timing.extraIdles === 1 ? "se añade 1 reposo" : `se añaden ${timing.extraIdles} reposos`} al final`);
    }
    if (Math.abs(timing.speed - 1) > 0.0005) parts.push(`animación al ${fmt(timing.speed * 100, 1)} %`);
    info.textContent = `${parts.join(", ")}.`;
  }

  for (const [label, track] of [
    ["La skin animada", state.skinTrack],
    [state.equipment === "elytra" ? "La élitra animada" : "La capa animada", state.capeTrack],
  ] as const) {
    if (!track || T === 0) continue;
    const rest = T % track.total;
    if (rest > frameMs && track.total - rest > frameMs) {
      notes.push(
        `${label} dura ${fmt(track.total / 1000)} s y el GIF ${fmt(T / 1000)} s: ` +
          `al volver al inicio del GIF su animación salta de frame.` +
          (state.autoFit ? "" : " Activa el ajuste automático para evitarlo."),
      );
    }
  }
  const el = $("warnings");
  el.textContent = notes.join(" ");
  el.hidden = notes.length === 0;
}

// ---------------------------------------------------------------- UI: sequence

const MAX_TIMES = 20;
let dragIndex: number | null = null;

function iconButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon";
  b.title = title;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

/** Moves the block at `from` so it ends up at position `to` of the list before the move. */
function moveItem(from: number, to: number): void {
  if (from === to || from + 1 === to) return;
  const [item] = state.items.splice(from, 1);
  state.items.splice(to > from ? to - 1 : to, 0, item);
  sequenceChanged();
}

function renderSequence(): void {
  const list = $("sequence");
  list.replaceChildren();
  const total = totalDuration();

  state.items.forEach((item, i) => {
    const row = document.createElement("li");
    row.className = `block${item.name === IDLE_ANIMATION ? " idle" : ""}`;
    row.draggable = true;

    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = "⠿";
    handle.title = "Arrastra para reordenar";

    const label = document.createElement("span");
    label.className = "name";
    label.textContent = LABELS[item.name] ?? item.name;

    const secs = document.createElement("span");
    secs.className = "secs";
    secs.textContent = `${fmt(lengthOf(item.name) * item.times)} s`;

    const times = document.createElement("span");
    times.className = "times";
    const count = document.createElement("span");
    count.textContent = `×${item.times}`;
    times.append(
      iconButton("−", "Una vez menos", () => {
        if (item.times > 1) item.times--;
        sequenceChanged();
      }),
      count,
      iconButton("+", "Una vez más", () => {
        item.times = Math.min(MAX_TIMES, item.times + 1);
        sequenceChanged();
      }),
    );

    row.append(
      handle,
      label,
      times,
      secs,
      iconButton("⧉", "Duplicar", () => {
        state.items.splice(i + 1, 0, { ...item });
        sequenceChanged();
      }),
      iconButton("×", "Quitar", () => {
        state.items.splice(i, 1);
        if (state.items.length === 0) state.items.push({ name: IDLE_ANIMATION, times: 1 });
        sequenceChanged();
      }),
    );

    row.ondragstart = (e) => {
      dragIndex = i;
      row.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    row.ondragend = () => {
      dragIndex = null;
      list.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((el) =>
        el.classList.remove("drop-before", "drop-after", "dragging"),
      );
    };
    const after = (e: DragEvent) => {
      const r = row.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2;
    };
    row.ondragover = (e) => {
      if (dragIndex === null) return;
      e.preventDefault();
      row.classList.toggle("drop-after", after(e));
      row.classList.toggle("drop-before", !after(e));
    };
    row.ondragleave = () => row.classList.remove("drop-before", "drop-after");
    row.ondrop = (e) => {
      e.preventDefault();
      if (dragIndex !== null) moveItem(dragIndex, after(e) ? i + 1 : i);
    };

    list.append(row);
  });

  const bar = $("timeline");
  bar.replaceChildren();
  for (const name of state.sequence) {
    const seg = document.createElement("div");
    seg.className = `seg${name === IDLE_ANIMATION ? " idle" : ""}`;
    seg.style.flexGrow = String(lengthOf(name));
    seg.textContent = LABELS[name] ?? name;
    bar.append(seg);
  }
  const head = document.createElement("div");
  head.id = "playhead";
  bar.append(head);

  $("seq-length").textContent = `Secuencia: ${fmt(total)} s`;
}

/** Recomputes the fitted timing after anything that changes durations, and refreshes the UI. */
function retime(): void {
  timing = computeTiming();
  const frames = Math.max(1, Math.round(timing.duration * state.fps));
  $("duration").textContent = `GIF: ${fmt(timing.duration)} s · ${frames} frames`;
  refreshWarnings();
  startTime = performance.now();
}

function sequenceChanged(): void {
  state.sequence = state.items.flatMap((item) => Array<string>(item.times).fill(item.name));
  renderSequence();
  retime();
}

/** Something like what the launcher does over minutes, packed into a short loop. */
function randomSequence(): SequenceItem[] {
  const pool = [...GESTURES].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 2);
  const items: SequenceItem[] = [];
  for (const gesture of pool.slice(0, count)) {
    items.push({ name: IDLE_ANIMATION, times: 1 + Math.floor(Math.random() * 2) });
    items.push({ name: gesture, times: 1 });
  }
  return items;
}

// ---------------------------------------------------------------- saved sequences

// Browser storage of this file only: a convenience, the tool works the same without it.
const SAVED_KEY = "neocapes-gif.sequences";

function readSaved(): Record<string, SequenceItem[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeSaved(saved: Record<string, SequenceItem[]>): boolean {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

/** Keeps only blocks with a known animation and a sane repeat count. */
function cleanItems(value: unknown): SequenceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v.name === "string" && v.name in ANIMATIONS)
    .map((v) => ({ name: v.name, times: Math.min(MAX_TIMES, Math.max(1, Math.round(Number(v.times) || 1))) }));
}

function renderSaved(selected = ""): void {
  const select = $<HTMLSelectElement>("saved");
  const names = Object.keys(readSaved()).sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option(names.length ? "Secuencias guardadas…" : "No hay secuencias guardadas", ""));
  for (const name of names) select.append(new Option(name, name));
  select.value = names.includes(selected) ? selected : "";
  $<HTMLButtonElement>("saved-delete").disabled = !select.value;
}

// ---------------------------------------------------------------- preview loop

const preview = $<HTMLCanvasElement>("preview");
const previewCtx = preview.getContext("2d")!;
let startTime = performance.now();

function resize(): void {
  viewer.setSize(state.width, state.height);
  preview.width = state.width;
  preview.height = state.height;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (state.exporting) return;
  const total = timing.duration;
  if (total <= 0) return;
  const t = ((now - startTime) / 1000) % total;
  renderAt(t);
  composite(previewCtx);
  const head = document.getElementById("playhead");
  if (head) head.style.left = `${poseAt(t).progress * 100}%`;
}

// ---------------------------------------------------------------- export

const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

/** Opaque pixels sampled for the global palette, spread over all frames. */
const PALETTE_SAMPLE_PIXELS = 2_000_000;

/** Appends every `stride`-th opaque pixel of `rgba` (from `offset`) to `pool`; returns the new length. */
function collectOpaque(rgba: Uint8ClampedArray, stride: number, offset: number, pool: Uint8ClampedArray, length: number): number {
  for (let p = offset * 4; p < rgba.length; p += stride * 4) {
    if (rgba[p + 3] === 0) continue;
    pool[length] = rgba[p];
    pool[length + 1] = rgba[p + 1];
    pool[length + 2] = rgba[p + 2];
    pool[length + 3] = 255;
    length += 4;
  }
  return length;
}

/**
 * Palette plus exact colour lookup. gifenc's applyPalette maps whole buckets of similar colours
 * (5-6 bits per channel, 4 with alpha) to the palette entry of whichever pixel of the bucket comes
 * first in each frame, so the same colour could change entry from one frame to the next and the
 * GIF flickered. Here every colour gets its own nearest entry, cached across all frames.
 */
class PaletteMapper {
  readonly palette: number[][];
  /** -1 when the GIF has no transparency. */
  readonly transparentIndex: number;
  private readonly colorCount: number;
  private readonly cache = new Map<number, number>();

  /** `opaquePixels` must own its whole buffer: gifenc reads `.buffer`, not the view. */
  constructor(opaquePixels: Uint8ClampedArray, maxColors: number, transparent: boolean) {
    // Quantized on opaque pixels only: alpha is handled apart, and every entry goes to colour.
    this.palette = opaquePixels.length ? quantize(opaquePixels, maxColors, { format: "rgb565" }) : [[0, 0, 0]];
    this.colorCount = this.palette.length;
    this.transparentIndex = transparent ? this.palette.length : -1;
    if (transparent) this.palette.push([0, 0, 0]);
  }

  private nearest(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let j = 0; j < this.colorCount; j++) {
      const c = this.palette[j];
      const dr = c[0] - r;
      const dg = c[1] - g;
      const db = c[2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = j;
        if (d === 0) break;
      }
    }
    this.cache.set(key, best);
    return best;
  }

  index(rgba: Uint8ClampedArray): Uint8Array {
    const out = new Uint8Array(rgba.length / 4);
    for (let p = 0, i = 0; i < rgba.length; i += 4, p++) {
      out[p] = rgba[i + 3] === 0 && this.transparentIndex >= 0
        ? this.transparentIndex
        : this.nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return out;
  }
}

async function exportGif(): Promise<void> {
  if (state.exporting) return;
  state.exporting = true;
  const button = $<HTMLButtonElement>("export");
  button.disabled = true;
  const progress = $<HTMLProgressElement>("progress");
  progress.hidden = false;

  try {
    const T = timing.duration;
    const count = Math.max(1, Math.round(T * state.fps));
    // GIF delays are in centiseconds.
    const delay = Math.round(1000 / state.fps / 10) * 10;
    const timeOf = (i: number) => (i * T) / count;
    const { width, height } = state;
    const transparent = state.transparent;
    // Transparent pixels get their own palette entry, after the colours.
    const colors = transparent ? 255 : 256;

    const work = document.createElement("canvas");
    work.width = width;
    work.height = height;
    const ctx = work.getContext("2d", { willReadFrequently: true })!;

    const grab = (i: number): Uint8ClampedArray => {
      renderAt(timeOf(i));
      composite(ctx);
      const data = ctx.getImageData(0, 0, width, height).data;
      if (state.transparent) {
        // GIF transparency is on/off: cut at half alpha and make the rest opaque.
        for (let p = 3; p < data.length; p += 4) {
          if (data[p] < 128) {
            data[p - 3] = data[p - 2] = data[p - 1] = data[p] = 0;
          } else {
            data[p] = 255;
          }
        }
      }
      return data;
    };

    let global: PaletteMapper | null = null;
    if (state.globalPalette) {
      // One palette built from every frame, so a colour looks the same in all of them.
      const pixels = width * height;
      const stride = Math.max(1, Math.ceil((pixels * count) / PALETTE_SAMPLE_PIXELS));
      const pool = new Uint8ClampedArray(4 * (Math.ceil(pixels / stride) + 1) * count);
      let length = 0;
      for (let i = 0; i < count; i++) {
        length = collectOpaque(grab(i), stride, i % stride, pool, length);
        if (i % 8 === 7) {
          progress.value = ((i + 1) / count) * 0.4;
          setStatus(`Analizando colores: frame ${i + 1} de ${count}…`);
          await yieldToBrowser();
        }
      }
      global = new PaletteMapper(pool.slice(0, length), colors, transparent);
    }

    const gif = GIFEncoder();
    for (let i = 0; i < count; i++) {
      const data = grab(i);
      let mapper = global;
      if (!mapper) {
        const pool = new Uint8ClampedArray(data.length);
        mapper = new PaletteMapper(pool.slice(0, collectOpaque(data, 1, 0, pool, 0)), colors, transparent);
      }
      gif.writeFrame(mapper.index(data), width, height, {
        palette: global && i > 0 ? undefined : mapper.palette,
        delay,
        repeat: 0,
        transparent,
        transparentIndex: Math.max(0, mapper.transparentIndex),
        dispose: transparent ? 2 : 1,
      });
      if (i % 4 === 3) {
        progress.value = global ? 0.4 + 0.6 * ((i + 1) / count) : (i + 1) / count;
        setStatus(`Codificando frame ${i + 1} de ${count}…`);
        await yieldToBrowser();
      }
    }
    gif.finish();

    const blob = new Blob([gif.bytes()], { type: "image/gif" });
    const url = URL.createObjectURL(blob);
    const result = $<HTMLImageElement>("result");
    const old = result.src;
    result.src = url;
    if (old.startsWith("blob:")) URL.revokeObjectURL(old);
    const link = $<HTMLAnchorElement>("download");
    link.href = url;
    link.download = `${state.name}-${state.equipment === "elytra" ? "elitra" : "capa"}.gif`;
    $("output").hidden = false;
    setStatus(`GIF listo: ${count} frames, ${(blob.size / 1024 / 1024).toFixed(2)} MB.`);
  } catch (err) {
    console.error(err);
    setStatus(`No se pudo generar el GIF: ${(err as Error).message}`, true);
  } finally {
    progress.hidden = true;
    progress.value = 0;
    button.disabled = false;
    state.exporting = false;
    startTime = performance.now();
  }
}

// ---------------------------------------------------------------- UI wiring

function bindFile(inputId: string, onBytes: (bytes: ArrayBuffer, name: string) => Promise<void>): void {
  const input = $<HTMLInputElement>(inputId);
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onBytes(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""));
      setStatus(`Cargado: ${file.name}`);
    } catch (err) {
      setStatus((err as Error).message, true);
    }
  };
}

async function loadSkinBytes(bytes: ArrayBuffer | null): Promise<void> {
  state.skinBytes = bytes;
  await applySkin();
  retime();
}

async function loadCapeBytes(bytes: ArrayBuffer | null): Promise<void> {
  state.capeBytes = bytes;
  await applyCape();
  retime();
}

bindFile("skin-file", (b) => loadSkinBytes(b));
/** A cape that does not come from the server list: drop the highlight there. */
function clearCatalogSelection(): void {
  capeCatalog.selectedUrl = null;
  if (capeCatalog.capes.length) renderCapeCatalog();
}

bindFile("cape-file", async (b, name) => {
  state.name = name;
  clearCatalogSelection();
  await loadCapeBytes(b);
});

$("skin-url-load").onclick = async () => {
  const url = $<HTMLInputElement>("skin-url").value.trim();
  if (!url) return;
  try {
    setStatus("Descargando skin…");
    await loadSkinBytes(await fetchBytes(url));
    setStatus("Skin cargada.");
  } catch (err) {
    setStatus(`${(err as Error).message}. Si es otro dominio, necesita cabeceras CORS.`, true);
  }
};

$("cape-url-load").onclick = async () => {
  const url = $<HTMLInputElement>("cape-url").value.trim();
  if (!url) return;
  try {
    setStatus("Descargando capa…");
    const bytes = await fetchBytes(url);
    state.name = safeName(decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "").replace(/\.[^.]+$/, "")) || "neocape";
    clearCatalogSelection();
    await loadCapeBytes(bytes);
    setStatus("Capa cargada.");
  } catch (err) {
    setStatus(`${(err as Error).message}. Si es otro dominio, necesita cabeceras CORS.`, true);
  }
};

$("cape-clear").onclick = () => {
  clearCatalogSelection();
  void loadCapeBytes(null);
};

// ---------------------------------------------------------------- NEOCapes catalogue

const capeCatalog = {
  capes: [] as NeoCape[],
  equippedId: null as number | null,
  selectedUrl: null as string | null,
  username: "",
};

const safeName = (s: string) => s.replace(/[^\w-]+/g, "_");

async function selectServerCape(cape: NeoCape): Promise<void> {
  try {
    setStatus(`Descargando ${cape.name}…`);
    capeCatalog.selectedUrl = cape.file_url;
    renderCapeCatalog();
    state.name = safeName(cape.name);
    await loadCapeBytes(await fetchBytes(cape.file_url));
    setStatus(`Capa: ${cape.name}`);
  } catch (err) {
    setStatus(`No se pudo cargar ${cape.name}: ${(err as Error).message}`, true);
  }
}

function renderCapeCatalog(): void {
  const section = $("capes-section");
  section.hidden = capeCatalog.capes.length === 0;
  const onlyOwned = $<HTMLInputElement>("capes-owned").checked;
  const grid = $("capes");
  grid.replaceChildren();

  const capes = capeCatalog.capes
    .filter((c) => !onlyOwned || c.can_equip)
    // The user's capes first, then by name.
    .sort((a, b) => Number(b.can_equip) - Number(a.can_equip) || a.name.localeCompare(b.name));

  for (const cape of capes) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cape-card";
    card.classList.toggle("owned", cape.can_equip);
    card.classList.toggle("selected", cape.file_url === capeCatalog.selectedUrl);
    card.title = cape.description || cape.name;

    // Shows the outer face of the cape: texels (1,1)-(11,17) of the 64x32 layout.
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = cape.file_url;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);

    const name = document.createElement("span");
    name.className = "cape-name";
    name.textContent = cape.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = cape.id === capeCatalog.equippedId ? "Equipada" : cape.can_equip ? "La tiene" : "";

    card.append(thumb, name, badge);
    card.onclick = () => void selectServerCape(cape);
    grid.append(card);
  }

  const owned = capeCatalog.capes.filter((c) => c.can_equip).length;
  $("capes-summary").textContent =
    `${capeCatalog.username} tiene ${owned} de ${capeCatalog.capes.length} NEOCapes visibles.`;
}

$<HTMLInputElement>("capes-owned").onchange = renderCapeCatalog;

$("player-load").onclick = async () => {
  const username = $<HTMLInputElement>("player").value.trim();
  const baseUrl = $<HTMLInputElement>("server").value.trim().replace(/\/+$/, "");
  if (!username || !baseUrl) return;
  try {
    setStatus(`Buscando a ${username}…`);
    const client = new NeoSkinsClient({ baseUrl });
    const [data, capes] = await Promise.all([
      client.getUserTextures(username),
      client.listCapes(username).catch((err) => {
        console.warn("[NEOCapes GIF] listCapes:", err);
        return [] as NeoCape[];
      }),
    ]);

    const skin = data.skin ?? data.fallback_skin;
    const skinUrl = skin?.url ?? `https://mc-heads.net/skin/${encodeURIComponent(username)}`;
    if (skin) {
      state.model = skin.variant === "slim" ? "slim" : "classic";
      $<HTMLSelectElement>("model").value = state.model;
    }

    capeCatalog.capes = capes;
    capeCatalog.username = data.username || username;
    capeCatalog.equippedId = data.cape?.id ?? null;
    capeCatalog.selectedUrl = data.cape?.url ?? null;
    renderCapeCatalog();

    const [skinBytes, capeBytes] = await Promise.all([
      fetchBytes(skinUrl),
      data.cape?.url ? fetchBytes(data.cape.url) : Promise.resolve(null),
    ]);
    state.name = safeName(data.cape?.name ?? username);
    await Promise.all([loadSkinBytes(skinBytes), loadCapeBytes(capeBytes)]);
    setStatus(
      data.cape
        ? `${username}: ${data.cape.name ?? "NEOCape"}. Elige otra capa en la lista.`
        : `${username} no tiene NEOCape equipada. Elige una en la lista.`,
    );
  } catch (err) {
    setStatus(`No se pudo cargar el jugador: ${(err as Error).message}`, true);
  }
};

$<HTMLInputElement>("player").onkeydown = (e) => {
  if (e.key === "Enter") $("player-load").click();
};

$<HTMLSelectElement>("model").onchange = (e) => {
  state.model = (e.target as HTMLSelectElement).value as ModelChoice;
  void applySkin();
};

for (const radio of document.querySelectorAll<HTMLInputElement>("input[name=equipment]")) {
  radio.onchange = () => {
    if (!radio.checked) return;
    state.equipment = radio.value as Equipment;
    $<HTMLInputElement>("wings").disabled = state.equipment !== "elytra";
    $("wings-row").classList.toggle("disabled", state.equipment !== "elytra");
    if (state.capeBytes) viewer.playerObject.backEquipment = state.equipment;
    refreshWarnings();
  };
}

const angle = $<HTMLInputElement>("angle");
angle.oninput = () => {
  state.angleDeg = Number(angle.value);
  $("angle-value").textContent = `${state.angleDeg}°`;
  applyCamera();
};

const wings = $<HTMLInputElement>("wings");
wings.oninput = () => {
  state.wingDeg = Number(wings.value);
  $("wings-value").textContent = `${wings.value}°`;
};

const pitch = $<HTMLInputElement>("pitch");
pitch.oninput = () => {
  state.pitchDeg = Number(pitch.value);
  $("pitch-value").textContent = `${state.pitchDeg}°`;
  applyCamera();
};

// Double click on a slider puts it back to its default.
for (const input of document.querySelectorAll<HTMLInputElement>("input[type=range]")) {
  input.ondblclick = () => {
    input.value = input.defaultValue;
    input.dispatchEvent(new Event("input"));
  };
}

const zoom = $<HTMLInputElement>("zoom");
zoom.oninput = () => {
  state.zoom = Number(zoom.value);
  $("zoom-value").textContent = state.zoom.toFixed(2);
  applyCamera();
};

for (const id of ["width", "height"] as const) {
  const input = $<HTMLInputElement>(id);
  input.onchange = () => {
    const v = Math.min(1024, Math.max(64, Math.round(Number(input.value) || 0)));
    input.value = String(v);
    state[id] = v;
    resize();
  };
}

$<HTMLSelectElement>("fps").onchange = (e) => {
  state.fps = Number((e.target as HTMLSelectElement).value);
  retime();
};

$<HTMLInputElement>("auto-fit").onchange = (e) => {
  state.autoFit = (e.target as HTMLInputElement).checked;
  retime();
};

const bgMode = () => {
  state.transparent = $<HTMLInputElement>("bg-transparent").checked;
  $<HTMLInputElement>("bg-color").disabled = state.transparent;
  preview.classList.toggle("checker", state.transparent);
};
$("bg-transparent").onchange = bgMode;
$("bg-solid").onchange = bgMode;
$<HTMLInputElement>("bg-color").oninput = (e) => {
  state.background = (e.target as HTMLInputElement).value;
};

$<HTMLInputElement>("outline").onchange = (e) => {
  state.outline = (e.target as HTMLInputElement).checked;
  enhancement.setEnabled(state.outline);
};

$<HTMLSelectElement>("palette").onchange = (e) => {
  state.globalPalette = (e.target as HTMLSelectElement).value === "global";
};

const adders = $("adders");
for (const name of [IDLE_ANIMATION, ...GESTURES]) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "small";
  b.textContent = `+ ${LABELS[name] ?? name}`;
  b.onclick = () => {
    // Adding the same animation as the last block just plays it once more.
    const last = state.items[state.items.length - 1];
    if (last?.name === name && last.times < MAX_TIMES) last.times++;
    else state.items.push({ name, times: 1 });
    sequenceChanged();
  };
  adders.append(b);
}
$("seq-random").onclick = () => {
  state.items = randomSequence();
  sequenceChanged();
};
$("seq-reset").onclick = () => {
  state.items = [{ name: IDLE_ANIMATION, times: 1 }];
  sequenceChanged();
};

const savedSelect = $<HTMLSelectElement>("saved");
savedSelect.onchange = () => {
  const items = cleanItems(readSaved()[savedSelect.value]);
  $<HTMLButtonElement>("saved-delete").disabled = !savedSelect.value;
  if (items.length === 0) return;
  state.items = items;
  $<HTMLInputElement>("saved-name").value = savedSelect.value;
  sequenceChanged();
  setStatus(`Secuencia cargada: ${savedSelect.value}`);
};
$("saved-save").onclick = () => {
  const input = $<HTMLInputElement>("saved-name");
  const name = input.value.trim();
  if (!name) {
    input.focus();
    setStatus("Ponle un nombre a la secuencia para guardarla.", true);
    return;
  }
  const saved = readSaved();
  const replaced = name in saved;
  saved[name] = state.items.map((i) => ({ ...i }));
  if (!writeSaved(saved)) {
    setStatus("El navegador no deja guardar datos para este archivo.", true);
    return;
  }
  renderSaved(name);
  setStatus(replaced ? `Secuencia «${name}» actualizada.` : `Secuencia «${name}» guardada.`);
};
$("saved-delete").onclick = () => {
  const name = savedSelect.value;
  if (!name) return;
  const saved = readSaved();
  delete saved[name];
  writeSaved(saved);
  renderSaved();
  setStatus(`Secuencia «${name}» borrada.`);
};

$("export").onclick = () => void exportGif();

// ---------------------------------------------------------------- start

applyCamera();
resize();
bgMode();
renderSaved();
sequenceChanged();
requestAnimationFrame(frame);
setStatus("Carga una skin y una capa para empezar.");
