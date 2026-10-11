---
description: Leer y cambiar skins y capas desde tu código.
icon: plug
---

# Cliente de la API

El cliente solo usa `fetch`. Funciona en el navegador, en un webview y en Node 18 o superior.

```ts
const client = new NeoSkinsClient({ baseUrl: "https://neobeta.miguelki.ovh" });
```

En Node, o si solo quieres el cliente sin el visor, impórtalo desde su propia entrada. No carga nada de WebGL:

```ts
import { NeoSkinsClient } from "neoskins-viewer/client";
```

## Leer

```ts
const state = await client.getUserTextures("Miguelki");      // skin, capa y vínculo de Discord
const capes = await client.listCapes("Miguelki", "offline"); // catálogo con can_equip
const head  = client.avatarUrl("Miguelki", 64);              // URL de la cabeza
```

## Demostrar que la cuenta es tuya

Cada escritura lleva unas credenciales:

```ts
// Cuenta premium: el token de acceso de Minecraft que ya tiene tu launcher
const credentials = { minecraftToken: accessToken };

// Cuenta No Premium: un ticket de Discord
const credentials = { verificationTicket: ticket };
```

Cómo conseguir el ticket de una cuenta No Premium:

```ts
async function getTicket(username: string): Promise<string> {
  // 1. Reutiliza el ticket guardado si sigue valiendo (dura 7 días)
  const saved = localStorage.getItem(`neo-ticket:${username}`);
  if (saved && (await client.checkTicket(username, saved)).valid) return saved;

  // 2. Si no, verifica en el navegador
  const pending = await client.startDiscordVerification(username);
  openInSystemBrowser(pending.verification_url); // función de tu launcher

  // 3. Espera a que el usuario termine
  const { ticket } = await client.waitForDiscordVerification(pending.verification_id);
  localStorage.setItem(`neo-ticket:${username}`, ticket);
  return ticket;
}
```

## Escribir

```ts
await client.uploadSkin({ username, file, variant: "slim", credentials }); // file: PNG 64x64
await client.deleteSkin(username, credentials);
await client.equipCape(username, cape.id, credentials);
await client.equipCape(username, null, credentials);   // quitar la capa
await client.redeemCode(username, "NEO-AB12-CD34", credentials);
```

{% hint style="info" %}
En una cuenta **premium** la skin se sube a Mojang, no al servidor NEO. Eso lo hace tu launcher con su token, contra `api.minecraftservices.com`. Las NEOCapes sí van siempre por este cliente.
{% endhint %}

## Errores

Todas las llamadas lanzan `NeoSkinsError` si fallan:

```ts
try {
  await client.uploadSkin({ username, file, credentials });
} catch (err) {
  if (err instanceof NeoSkinsError) {
    console.log(err.status);  // 400, 401, 403, 429...
    console.log(err.code);    // "SkinBlacklisted", "TicketInvalid"...
    showToast(err.message);   // texto para el usuario
  }
}
```

Si recibes `TicketInvalid`, borra el ticket guardado y vuelve a verificar. La lista completa de códigos está en la [API de NEOSkins](api.md#errores).
