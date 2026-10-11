import type { SkinViewer } from "skinview3d";
import { SkinViewBlockbench, type AnimationFileType } from "skinview3d-blockbench";
import modelAnimations from "./animations/model.animation.json";

export interface SkinAnimationController {
  animation: SkinViewBlockbench;
  playAnimation: (animName: string) => void;
  playReaction: (animName?: string) => void;
  destroy: () => void;
}

export const RANDOM_ANIMATIONS = ["look", "scratch", "salute", "hi"] as const;
export const IDLE_ANIMATION = "idle_loop";

// Initial aesthetic rotation (Y axis gently rotated towards the right for 3D depth, ~+26 degrees)
export const DEFAULT_ROTATION_Y = 0.45;
export const DEFAULT_ROTATION_X = 0;

/**
 * Ensures all bones in all animations have default position keyframes if missing,
 * preventing bones (like Head) from retaining unwanted offsets from Three.js scene hierarchy transformations.
 */
function getNormalizedAnimations(data: AnimationFileType): AnimationFileType {
  const cloned = JSON.parse(JSON.stringify(data)) as AnimationFileType;
  for (const animName of Object.keys(cloned.animations)) {
    const anim = cloned.animations[animName];
    if (!anim.bones) continue;
    
    // Ensure all standard bones have a 0.0 position keyframe
    for (const boneName of Object.keys(anim.bones)) {
      const bone = anim.bones[boneName];
      if (bone && !bone.position) {
        bone.position = {
          "0.0": {
            post: [0, 0, 0],
            lerp_mode: "linear",
          },
        };
      }
    }

    // Ensure Body bone has default 0.0 rotation to keep cape straight with torso
    if (anim.bones["Body"]) {
      if (!anim.bones["Body"].rotation) {
        anim.bones["Body"].rotation = {
          "0.0": {
            post: [0, 0, 0],
            lerp_mode: "linear",
          },
        };
      } else if (!anim.bones["Body"].rotation["0.0"]) {
        anim.bones["Body"].rotation["0.0"] = {
          post: [0, 0, 0],
          lerp_mode: "linear",
        };
      }
    }
  }
  return cloned;
}

const normalizedModelAnimations = getNormalizedAnimations(
  modelAnimations as unknown as AnimationFileType,
);

/**
 * Attaches the Blockbench animations to a SkinViewer instance,
 * configures initial rotation, disables autoRotate, provides animation extrapolation/crossfading,
 * and manages scheduling of random idle animations.
 */
export function setupSkinAnimation(
  skinViewer: SkinViewer,
  options?: {
    minIntervalMs?: number;
    maxIntervalMs?: number;
    rotationY?: number;
    rotationX?: number;
    connectCape?: boolean;
  },
): SkinAnimationController {
  const minInterval = options?.minIntervalMs ?? 30000;
  const maxInterval = options?.maxIntervalMs ?? 45000;
  const rotY = options?.rotationY ?? DEFAULT_ROTATION_Y;
  const rotX = options?.rotationX ?? DEFAULT_ROTATION_X;
  const connectCape = options?.connectCape ?? true;

  // Disable auto-rotate
  skinViewer.autoRotate = false;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isDestroyed = false;
  let animBlockbench: SkinViewBlockbench | null = null;

  const scheduleNextRandomAnimation = () => {
    if (isDestroyed) return;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const randomDelay = Math.floor(
      Math.random() * (maxInterval - minInterval + 1) + minInterval,
    );

    timeoutId = setTimeout(() => {
      if (isDestroyed || !animBlockbench) return;
      const nextAnim =
        RANDOM_ANIMATIONS[Math.floor(Math.random() * RANDOM_ANIMATIONS.length)];
      playAnimation(nextAnim);
    }, randomDelay);
  };

  const playAnimation = (animName: string) => {
    if (isDestroyed || !animBlockbench) return;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    try {
      // SkinViewBlockbench smoothly switches animations
      animBlockbench.setAnimation(animName);
    } catch (err) {
      console.warn(`[SkinAnimation] Error playing animation '${animName}':`, err);
    }
  };

  /**
   * Triggers a lively reaction animation (e.g. when changing skin or cape)
   */
  const playReaction = (animName?: string) => {
    const reaction = animName || "fall";
    playAnimation(reaction);
  };

  animBlockbench = new SkinViewBlockbench({
    animation: normalizedModelAnimations,
    animationName: IDLE_ANIMATION,
    connectCape: false, // We handle cape attachment and alignment manually with exact Minecraft offsets
    bonesOverrides: {
      head: "Head",
      body: "Body",
      rightArm: "Right Arm",
      leftArm: "Left Arm",
      rightLeg: "Right Leg",
      leftLeg: "Left Leg",
      torso: "Torso",
    },
    onFinish: () => {
      if (isDestroyed || !animBlockbench) return;
      // When a single-shot animation finishes, return to idle_loop
      try {
        animBlockbench.setAnimation(IDLE_ANIMATION);
      } catch (err) {
        console.warn("[SkinAnimation] Error returning to idle_loop:", err);
      }
      // Schedule the next random animation
      scheduleNextRandomAnimation();
    },
  });

  skinViewer.animation = animBlockbench;

  // Ensure cape is properly positioned, aligned and attached to the player's torso
  if (connectCape && skinViewer.playerObject) {
    const playerObj = skinViewer.playerObject;
    const capeObj = playerObj.cape;
    
    // In skinview3d, cape is originally at y: 8, z: -2, rotX: 10.8 deg, rotY: PI.
    // When TorsoWrapper is created by SkinViewBlockbench, skin parts are grouped into torso (y: 8, body is at y: -6).
    // Attaching cape directly to playerObject.skin.body ensures it follows torso rotations perfectly with exact Minecraft offsets:
    if (capeObj && playerObj.skin && playerObj.skin.body) {
      playerObj.skin.body.add(capeObj);
      capeObj.position.set(0, 6, -2);
      capeObj.rotation.set((10.8 * Math.PI) / 180, Math.PI, 0);
    }
  }

  // Apply clean single-axis rotation to playerWrapper only (avoids tilting and double rotation)
  skinViewer.playerWrapper.rotation.set(rotX, rotY, 0);
  skinViewer.playerObject.rotation.set(0, 0, 0);

  // Start initial schedule
  scheduleNextRandomAnimation();

  return {
    animation: animBlockbench,
    playAnimation,
    playReaction,
    destroy: () => {
      isDestroyed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

