import { SkinViewer } from "skinview3d";
import { setupSkinAnimation, type SkinAnimationController } from "./animation";
import { enhanceSkinViewer, type SkinViewerEnhancement } from "./outline";
import {
  createGifCapePlayer,
  createGifSkinPlayer,
  type GifCapePlayer,
  type GifSkinPlayer,
} from "./gifTextures";
import { fixSkinUvBleeding } from "./uvBleed";
import type { NeoSkinsClient } from "./client";

/** "classic" (4px arms, Steve) or "slim" (3px arms, Alex). "auto" reads it from the skin image. */
export type SkinModel = "classic" | "slim" | "auto";

/** Animations shipped with the viewer. */
export type AnimationName =
  | "idle_loop"
  | "look"
  | "scratch"
  | "salute"
  | "hi"
  | "fall"
  | "show_cape";

export interface OutlineOptions {
  /** Thickness in screen pixels. Default 1.3. */
  thickness?: number;
  /** Multiplier applied to the edge colour. Default 1.35. */
  brightnessBoost?: number;
  /** Added to the edge colour, lifts dark skins. Default 0.1. */
  brightnessOffset?: number;
}

export interface AnimationOptions {
  /** Shortest wait between two random idle gestures. Default 30000. */
  minIntervalMs?: number;
  /** Longest wait between two random idle gestures. Default 45000. */
  maxIntervalMs?: number;
}

export interface NeoSkinViewerOptions {
  /** Canvas size in CSS pixels. Defaults to the size of the container. */
  width?: number;
  height?: number;
  /** Follow the container size with a ResizeObserver. Default true. */
  autoResize?: boolean;

  /** Skin to show at start (URL or data URL, PNG or animated GIF). */
  skin?: string | null;
  model?: SkinModel;
  /** Cape to show at start (URL or data URL, PNG or animated GIF). */
  cape?: string | null;

  /** Bedrock-style edge highlight. `false` turns it off. Default on. */
  outline?: boolean | OutlineOptions;
  /** FXAA pass. Default true. */
  antialias?: boolean;
  /** Supersampling factor. Default: device pixel ratio, capped at 2. */
  pixelRatio?: number;

  /** Idle loop and random gestures. `false` leaves the model in its rest pose. Default on. */
  animations?: boolean | AnimationOptions;
  /** Play "fall" when the skin changes and "show_cape" when the cape changes. Default true. */
  reactions?: boolean;

  /** Drag to rotate. Default true. */
  rotate?: boolean;
  /** Mouse wheel zoom. Default false. */
  zoom?: boolean;
  /** Starting angle in radians around the vertical axis. Default 0.45. */
  rotationY?: number;
  /** Canvas background (CSS colour). Default transparent. */
  background?: string | null;

  /** Called while an animated cape is being downloaded and decoded. */
  onCapeLoadingChange?: (loading: boolean) => void;
}

function resolveContainer(target: HTMLElement | string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`NeoSkinViewer: container not found (${String(target)})`);
  return el;
}

function toViewerModel(model: SkinModel | undefined): "default" | "slim" | "auto-detect" {
  if (model === "slim") return "slim";
  if (model === "classic") return "default";
  return "auto-detect";
}

/**
 * The NEO skin viewer: a skinview3d canvas with the outline shader, FXAA and
 * supersampling, animated (GIF) skins and capes, HD and square capes, and the
 * Blockbench animations of NEOLauncher.
 */
export class NeoSkinViewer {
  /** The underlying skinview3d viewer, for anything this class does not cover. */
  readonly viewer: SkinViewer;
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly reactions: boolean;
  private animation: SkinAnimationController | null = null;
  private enhancement: SkinViewerEnhancement;
  private capePlayer: GifCapePlayer;
  private skinPlayer: GifSkinPlayer;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private hasSkin = false;
  private capeLoads = 0;

  constructor(target: HTMLElement | string, options: NeoSkinViewerOptions = {}) {
    this.container = resolveContainer(target);
    this.reactions = options.reactions ?? true;

    this.viewer = new SkinViewer({
      width: options.width ?? (this.container.clientWidth || 300),
      height: options.height ?? (this.container.clientHeight || 400),
    });
    this.canvas = this.viewer.canvas;
    this.canvas.style.display = "block";
    this.container.appendChild(this.canvas);

    if (options.background) this.viewer.background = options.background;
    this.viewer.controls.enableZoom = options.zoom ?? false;
    this.viewer.controls.enableRotate = options.rotate ?? true;
    this.viewer.controls.enablePan = false;

    if (options.animations !== false) {
      const timing = typeof options.animations === "object" ? options.animations : {};
      this.animation = setupSkinAnimation(this.viewer, { ...timing, rotationY: options.rotationY });
    } else {
      this.viewer.autoRotate = false;
      this.viewer.playerWrapper.rotation.set(0, options.rotationY ?? 0.45, 0);
    }

    fixSkinUvBleeding(this.viewer);

    const outline = typeof options.outline === "object" ? options.outline : {};
    this.enhancement = enhanceSkinViewer(this.viewer, {
      enabled: options.outline !== false,
      pixelRatio: options.pixelRatio,
      outlineThickness: outline.thickness,
      brightnessBoost: outline.brightnessBoost,
      brightnessOffset: outline.brightnessOffset,
    });
    this.viewer.fxaaPass.enabled = options.antialias ?? true;

    this.capePlayer = createGifCapePlayer(this.viewer, {
      onLoadingChange: options.onCapeLoadingChange,
    });
    this.skinPlayer = createGifSkinPlayer(this.viewer);

    if ((options.autoResize ?? true) && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w > 0 && h > 0) this.setSize(w, h);
      });
      this.resizeObserver.observe(this.container);
    }

    if (options.skin) void this.setSkin(options.skin, options.model).catch(() => {});
    if (options.cape) void this.setCape(options.cape).catch(() => {});
  }

  /** Shows a skin (PNG or animated GIF). Rejects if the image cannot be loaded. */
  async setSkin(url: string, model: SkinModel = "auto"): Promise<void> {
    if (this.disposed) return;
    const react = this.reactions && this.hasSkin;
    this.hasSkin = true;
    await this.skinPlayer.loadSkin(url, toViewerModel(model));
    if (react) this.play("fall");
  }

  /** Switches between 4px ("classic") and 3px ("slim") arms without reloading the skin. */
  setModel(model: "classic" | "slim"): void {
    this.viewer.playerObject.skin.modelType = model === "slim" ? "slim" : "default";
  }

  /** Shows a cape (PNG or animated GIF, any HD size), or removes it with `null`. */
  async setCape(url: string | null): Promise<void> {
    if (this.disposed) return;
    // The first call is the initial state of the player, not a change worth reacting to.
    const react = this.reactions && Boolean(url) && this.capeLoads > 0;
    this.capeLoads++;
    await this.capePlayer.loadCape(url);
    if (react) this.play("show_cape");
  }

  /**
   * Loads what the NEO server has for `username`: the uploaded skin, or the official
   * Mojang skin of that name, or the default skin; and the equipped NEOCape.
   */
  async loadPlayer(client: NeoSkinsClient, username: string): Promise<void> {
    const data = await client.getUserTextures(username);
    const skin = data.skin ?? data.fallback_skin;
    const skinUrl = skin?.url ?? `https://mc-heads.net/skin/${encodeURIComponent(username)}`;
    await Promise.all([
      this.setSkin(skinUrl, skin ? (skin.variant === "slim" ? "slim" : "classic") : "auto"),
      this.setCape(data.cape?.url ?? null),
    ]);
  }

  /** Plays one of the bundled animations; one-shot ones return to the idle loop when done. */
  play(name: AnimationName): void {
    this.animation?.playAnimation(name);
  }

  setOutline(enabled: boolean, options: OutlineOptions = {}): void {
    this.enhancement.setEnabled(enabled);
    if (options.thickness !== undefined) this.enhancement.setOutlineThickness(options.thickness);
    if (options.brightnessBoost !== undefined) {
      this.enhancement.setBrightnessBoost(options.brightnessBoost, options.brightnessOffset);
    }
  }

  setAntialias(enabled: boolean): void {
    this.viewer.fxaaPass.enabled = enabled;
  }

  setSize(width: number, height: number): void {
    if (this.disposed) return;
    this.viewer.setSize(width, height);
  }

  /** Current frame as a PNG data URL (transparent background unless one was set). */
  screenshot(): string {
    this.viewer.render();
    return this.canvas.toDataURL("image/png");
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Stops timers, frees the WebGL context and removes the canvas. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.skinPlayer.destroy();
    this.capePlayer.destroy();
    this.enhancement.dispose();
    this.animation?.destroy();
    this.animation = null;
    this.viewer.dispose();
    this.canvas.remove();
  }
}
