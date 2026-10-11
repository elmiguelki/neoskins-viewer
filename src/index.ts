export { NeoSkinViewer } from "./NeoSkinViewer";
export type {
  NeoSkinViewerOptions,
  OutlineOptions,
  AnimationOptions,
  AnimationName,
  SkinModel,
} from "./NeoSkinViewer";

export { NeoSkinsClient, NeoSkinsError } from "./client";
export type {
  NeoSkinsClientOptions,
  OwnerCredentials,
  SkinVariant,
  AccountType,
  SkinInfo,
  CapeInfo,
  PlayerTextures,
  UserTextures,
  NeoCape,
  PendingDiscordVerification,
  DiscordVerificationStatus,
  TicketCheck,
} from "./client";

// Building blocks, for anyone who already owns a skinview3d viewer.
export { setupSkinAnimation, RANDOM_ANIMATIONS, IDLE_ANIMATION } from "./animation";
export { enhanceSkinViewer } from "./outline";
export { createGifCapePlayer, createGifSkinPlayer } from "./gifTextures";
export { fixSkinUvBleeding } from "./uvBleed";
