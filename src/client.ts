/**
 * Small client for the NEOSkins HTTP API. It only uses `fetch`, so it works in a
 * browser, a webview (Electron, Tauri) and Node 18+.
 */

export type SkinVariant = "classic" | "slim";
export type AccountType = "microsoft" | "offline";

/**
 * Proof that the caller owns the username. Send exactly one:
 *  - `minecraftToken`: Minecraft access token of a premium account.
 *  - `verificationTicket`: Discord ticket of a No Premium account (see `startDiscordVerification`).
 *  - `discordToken`: Discord OAuth access token of a No Premium account that is already linked.
 */
export interface OwnerCredentials {
  minecraftToken?: string;
  verificationTicket?: string;
  discordToken?: string;
}

export interface SkinInfo {
  url: string;
  avatar_url?: string;
  variant: SkinVariant;
  hash?: string;
  updated_at?: string;
  source?: string;
}

export interface CapeInfo {
  id?: number;
  name?: string;
  url: string;
  updated_at?: string;
  source?: string;
}

/** Answer of `GET /textures/:username`: what the game shows for that player. */
export interface PlayerTextures {
  username: string;
  skin: SkinInfo | null;
  cape: CapeInfo | null;
}

/** Answer of `GET /user-textures/user/:username`: what a skin editor needs. */
export interface UserTextures {
  success: boolean;
  username: string;
  default_model: SkinVariant;
  is_discord_linked: boolean;
  discord_user_id: string | null;
  /** Skin uploaded to the NEO server, or null. */
  skin: SkinInfo | null;
  /** Official Mojang skin of that name, only filled when `skin` is null. */
  fallback_skin: { url: string; variant: SkinVariant; hash?: string } | null;
  fallback_status: "ok" | "not_premium" | "unavailable" | null;
  cape: CapeInfo | null;
}

export interface NeoCape {
  id: number;
  name: string;
  description: string;
  file_name: string;
  /** PNG or animated GIF. */
  file_url: string;
  is_public: boolean;
  is_hidden: boolean;
  allowed_count: number;
  can_equip: boolean;
}

export interface PendingDiscordVerification {
  verification_id: string;
  /** Open this in the system browser. */
  verification_url: string;
  status_url: string;
  expires_at: string;
}

export type DiscordVerificationStatus =
  | { status: "pending"; message?: string }
  | { status: "authorized"; token: string; discord_username?: string; message?: string }
  | { status: "expired"; message?: string }
  | { status: "impersonation_blocked"; message?: string }
  | { status: "not_member"; server_invite_url?: string; message?: string };

export interface TicketCheck {
  valid: boolean;
  reason?: "invalid_or_expired" | "claimed_by_other";
  username?: string;
  discord_user_id?: string;
  discord_username?: string | null;
  expires_at?: string;
}

/** Thrown for every non-2xx answer. `code` is the `error` field of the server when it sends one. */
export class NeoSkinsError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;

  constructor(status: number, code: string | null, message: string, body?: unknown) {
    super(message);
    this.name = "NeoSkinsError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface NeoSkinsClientOptions {
  /** Server origin, e.g. "https://neobeta.miguelki.ovh". No trailing "/api". */
  baseUrl: string;
  /** Custom fetch (tests, Node < 18, a proxying webview bridge). */
  fetch?: typeof fetch;
}

function credentialFields(creds: OwnerCredentials): Record<string, string> {
  const out: Record<string, string> = {};
  if (creds.minecraftToken) out.minecraft_token = creds.minecraftToken;
  if (creds.verificationTicket) out.verification_ticket = creds.verificationTicket;
  if (creds.discordToken) out.discord_token = creds.discordToken;
  return out;
}

export class NeoSkinsClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NeoSkinsClientOptions) {
    this.baseUrl = String(options.baseUrl || "").replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "");
    if (!this.baseUrl) throw new Error("NeoSkinsClient: baseUrl is required");
    const impl = options.fetch ?? globalThis.fetch;
    if (!impl) throw new Error("NeoSkinsClient: no fetch available, pass options.fetch");
    this.fetchImpl = options.fetch ? impl : impl.bind(globalThis);
  }

  // ------------------------------------------------------------------ URLs

  /** Skin uploaded to the server for `username` (404 if there is none). */
  skinUrl(username: string): string {
    return `${this.baseUrl}/api/v1/textures/skin/${encodeURIComponent(username)}.png`;
  }

  /** Equipped NEOCape of `username`, PNG or animated GIF (404 if there is none). */
  capeUrl(username: string): string {
    return `${this.baseUrl}/api/v1/textures/cape/${encodeURIComponent(username)}.png`;
  }

  /** Head render, always answers with an image. `size` is clamped to 16-512 by the server. */
  avatarUrl(username: string, size = 128): string {
    return `${this.baseUrl}/api/v1/textures/avatar/${encodeURIComponent(username)}.png?size=${size}`;
  }

  // ----------------------------------------------------------------- reads

  /** What the game shows for a player: server skin and cape, with the Mojang ones as fallback. */
  getTextures(username: string): Promise<PlayerTextures> {
    return this.request("GET", `/api/v1/textures/${encodeURIComponent(username)}`);
  }

  /** Same as `getTextures` for up to 100 names in one request. */
  async getTexturesBatch(usernames: string[]): Promise<Record<string, PlayerTextures>> {
    const res = await this.request<{ textures: Record<string, PlayerTextures> }>(
      "POST",
      "/api/v1/textures/batch",
      { usernames },
    );
    return res.textures || {};
  }

  /** State of an account for a skin editor: server skin, Mojang fallback, equipped cape, Discord link. */
  getUserTextures(username: string): Promise<UserTextures> {
    return this.request("GET", `/api/v1/user-textures/user/${encodeURIComponent(username)}`);
  }

  /** NEOCapes `username` can see. `can_equip` tells which ones it may wear. */
  async listCapes(username?: string, accountType?: AccountType): Promise<NeoCape[]> {
    const query = new URLSearchParams();
    if (username) query.set("username", username);
    if (accountType) query.set("account_type", accountType);
    const suffix = query.toString() ? `?${query}` : "";
    const res = await this.request<{ capes: NeoCape[] }>("GET", `/api/v1/textures/neocapes${suffix}`);
    return res.capes || [];
  }

  // ---------------------------------------------------------------- writes

  /** Uploads a 64x64 (or 64x32) PNG skin, up to 2 MB, and makes it the active one. */
  uploadSkin(params: {
    username: string;
    file: Blob;
    variant?: SkinVariant;
    credentials: OwnerCredentials;
  }): Promise<{ success: true; message: string; skin: SkinInfo }> {
    const form = new FormData();
    form.append("username", params.username);
    form.append("variant", params.variant === "slim" ? "slim" : "classic");
    for (const [key, value] of Object.entries(credentialFields(params.credentials))) {
      form.append(key, value);
    }
    form.append("skin_file", params.file, "skin.png");
    return this.request("POST", "/api/v1/user-textures/skin", form);
  }

  /** Removes the server skin; the player goes back to the Mojang or default skin. */
  deleteSkin(username: string, credentials: OwnerCredentials): Promise<{ success: true }> {
    return this.request("DELETE", "/api/v1/user-textures/skin", {
      username,
      ...credentialFields(credentials),
    });
  }

  /** Equips a NEOCape, or unequips the current one when `capeId` is null. */
  equipCape(
    username: string,
    capeId: number | null,
    credentials: OwnerCredentials,
  ): Promise<{ success: true; message: string; cape?: CapeInfo }> {
    return this.request("POST", "/api/v1/user-textures/cape", {
      username,
      neocape_id: capeId,
      ...credentialFields(credentials),
    });
  }

  /** Unlocks an exclusive NEOCape with a code. */
  redeemCode(
    username: string,
    code: string,
    credentials: OwnerCredentials,
  ): Promise<{ success: true; message: string; [key: string]: unknown }> {
    return this.request("POST", "/api/v1/textures/neocapes/redeem-code", {
      username,
      code,
      ...credentialFields(credentials),
    });
  }

  // -------------------------------------------- Discord verification (No Premium)

  /** Whether a stored ticket still proves the ownership of `username`. */
  checkTicket(username: string, ticket: string): Promise<TicketCheck> {
    return this.request("POST", "/api/v1/skin-web/auth/discord/ticket-check", {
      username,
      verification_ticket: ticket,
    });
  }

  /** Opens a verification. Send the user to `verification_url`, then call `waitForDiscordVerification`. */
  startDiscordVerification(username: string): Promise<PendingDiscordVerification> {
    return this.request("POST", "/api/v1/skin-web/auth/discord/game-session", { username });
  }

  pollDiscordVerification(verificationId: string): Promise<DiscordVerificationStatus> {
    return this.request("GET", `/api/pack/verify-status/${encodeURIComponent(verificationId)}`);
  }

  /**
   * Polls until the user finishes in the browser and resolves with the ticket.
   * Rejects with a NeoSkinsError (`code`: "expired", "impersonation_blocked",
   * "not_member", "timeout" or "aborted") otherwise.
   */
  async waitForDiscordVerification(
    verificationId: string,
    options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ ticket: string; discordUsername: string | null }> {
    const interval = Math.max(1000, options.intervalMs ?? 2000);
    const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000);

    for (;;) {
      if (options.signal?.aborted) {
        throw new NeoSkinsError(0, "aborted", "Verificación cancelada");
      }
      const state = await this.pollDiscordVerification(verificationId);
      if (state.status === "authorized") {
        return { ticket: state.token, discordUsername: state.discord_username ?? null };
      }
      if (state.status !== "pending") {
        throw new NeoSkinsError(0, state.status, state.message || state.status, state);
      }
      if (Date.now() + interval > deadline) {
        throw new NeoSkinsError(0, "timeout", "La verificación no se completó a tiempo");
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  // -------------------------------------------------------------- internal

  private async request<T>(method: string, path: string, body?: FormData | object): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    let payload: BodyInit | undefined;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      payload = body; // fetch sets the multipart boundary itself
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, { method, headers, body: payload });
    } catch (err) {
      throw new NeoSkinsError(0, "network", err instanceof Error ? err.message : "Network error");
    }

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty or non-JSON body */
    }

    if (!res.ok) {
      const code = json && typeof json.error === "string" ? json.error : null;
      const message = (json && (json.message || json.error)) || `HTTP ${res.status}`;
      throw new NeoSkinsError(res.status, code, String(message), json);
    }
    return (json ?? {}) as T;
  }
}
