---
description: Referencia HTTP de la API de skins y capas de NEO.
icon: server
---

# API de NEOSkins

Guía para integrar skins y capas de NEO en un launcher, una web o un mod de terceros.

- **Servidor:** `https://neobeta.miguelki.ovh`
- **Prefijo:** todas las rutas cuelgan de `/api/v1`.
- **Formato:** JSON, salvo la subida de skin, que es `multipart/form-data`.
- **CORS:** abierto. Se puede llamar desde un navegador o un webview.

{% hint style="success" %}
Si tu aplicación tiene interfaz web, [NEOSkins Viewer](instalacion.md) trae el visor 3D y un [cliente de esta API](cliente.md). Es el camino más corto.
{% endhint %}

## Lo básico en un minuto

1. **Leer es público.** Cualquiera puede pedir la skin y la capa de un jugador. No hace falta clave.
2. **Escribir exige demostrar que la cuenta es tuya.** Cada petición de escritura lleva una credencial del jugador.
3. **La credencial depende del tipo de cuenta:**

| Cuenta | Credencial | Campo |
|---|---|---|
| Premium (Microsoft) | Token de acceso de Minecraft. El servidor lo comprueba contra Mojang. | `minecraft_token` |
| No Premium | Ticket de Discord. Se consigue con el flujo de verificación de más abajo. | `verification_ticket` |


{% hint style="info" %}
**Para que la skin se vea dentro del juego** los jugadores necesitan el mod NEOSkins o NEOLoader. Sin el mod, el juego solo muestra las skins de Mojang.
{% endhint %}

## Qué se guarda en el servidor

| | Premium | No Premium |
|---|---|---|
| Skin | En Mojang. Se sube a `api.minecraftservices.com`, no aquí. | En el servidor NEO. |
| Capa oficial de Mojang | En Mojang. | No tiene. |
| NEOCape | En el servidor NEO. | En el servidor NEO. |

Una cuenta premium también puede subir una skin al servidor NEO. Si existe, esta API la devuelve en lugar de la de Mojang.

## Lectura

### Texturas de un jugador

```
GET /api/v1/textures/:username
```

Devuelve lo que el juego muestra para ese nombre. Si no hay skin o capa en el servidor, rellena con las de Mojang.

```json
{
  "username": "Miguelki",
  "skin": {
    "url": "https://neobeta.miguelki.ovh/api/v1/textures/skin/Miguelki.png?v=ab12...",
    "avatar_url": "https://neobeta.miguelki.ovh/api/v1/textures/avatar/Miguelki.png?v=ab12...",
    "variant": "classic",
    "hash": "ab12...",
    "source": "launcher"
  },
  "cape": {
    "id": 3,
    "name": "Moon Wave",
    "url": "https://neobeta.miguelki.ovh/api/v1/textures/cape/Miguelki.png?v=1791677259683",
    "source": "launcher"
  }
}
```

`skin` y `cape` pueden ser `null`. `variant` es `classic` (brazos de 4 px) o `slim` (3 px).

### Varios jugadores a la vez

```
POST /api/v1/textures/batch
{ "usernames": ["Miguelki", "Notch"] }
```

Hasta 100 nombres. Responde `{ "success": true, "textures": { "<nombre>": { ... } } }` con el mismo formato de arriba.

### Estado de una cuenta para un editor de skins

```
GET /api/v1/user-textures/user/:username
```

Es la ruta que conviene usar en un editor. Separa la skin del servidor de la de Mojang.

```json
{
  "success": true,
  "username": "Miguelki",
  "default_model": "classic",
  "is_discord_linked": true,
  "discord_user_id": "123456789",
  "skin": { "url": "...", "avatar_url": "...", "variant": "slim", "hash": "...", "updated_at": "..." },
  "fallback_skin": null,
  "fallback_status": null,
  "cape": { "id": 3, "name": "Moon Wave", "url": "...", "updated_at": "..." }
}
```

- `skin` solo describe una skin subida al servidor NEO.
- `fallback_skin` es la skin oficial de Mojang de ese nombre. Solo viene cuando `skin` es `null`.
- `fallback_status` indica el resultado de esa consulta: `ok`, `not_premium` o `unavailable`.

### Archivos de imagen

| Ruta | Devuelve |
|---|---|
| `GET /api/v1/textures/skin/:username.png` | PNG 64x64 de la skin del servidor. `404` si no hay. |
| `GET /api/v1/textures/cape/:username.png` | NEOCape equipada. **Puede ser un GIF animado aunque la URL acabe en `.png`.** `404` si no hay. |
| `GET /api/v1/textures/avatar/:username.png?size=128` | Cabeza renderizada, de 16 a 512 px. Siempre devuelve una imagen. |
| `GET /api/v1/textures/neocape-file/:file_name` | Archivo de una NEOCape del catálogo, PNG o GIF. |

{% hint style="warning" %}
Para saber si una capa es animada hay que mirar el `Content-Type` o los primeros bytes (`GIF8`), no la extensión.
{% endhint %}

### Catálogo de NEOCapes

```
GET /api/v1/textures/neocapes?username=Miguelki&account_type=offline
```

```json
{
  "success": true,
  "capes": [
    {
      "id": 3,
      "name": "Moon Wave",
      "description": "Capa de evento",
      "file_name": "cape_moon_1791677259683.gif",
      "file_url": "https://neobeta.miguelki.ovh/api/v1/textures/neocape-file/cape_moon_1791677259683.gif",
      "is_public": false,
      "is_hidden": false,
      "allowed_count": 12,
      "can_equip": true
    }
  ]
}
```

- `can_equip` dice si ese `username` puede ponérsela. Sin `username` solo es `true` en las públicas.
- Las capas **ocultas** no aparecen en la lista para quien no esté autorizado.
- Una capa exclusiva se desbloquea canjeando un código.

## Verificación de Discord (cuentas No Premium)

Una cuenta No Premium no tiene contraseña. Su dueño es la cuenta de Discord vinculada a ese nombre. El ticket demuestra ese vínculo sin que tu aplicación toque el token de Discord.

```
tu app                         servidor NEO                    navegador
  │  POST .../discord/game-session  │                              │
  │ ───────────────────────────────>│                              │
  │  verification_id + url          │                              │
  │ <───────────────────────────────│                              │
  │  abre verification_url ─────────────────────────────────────── >│
  │                                 │   login de Discord (OAuth)   │
  │                                 │ <────────────────────────────│
  │  GET /api/pack/verify-status/:id  (cada 2 s)                    │
  │ ───────────────────────────────>│                              │
  │  status: "authorized", token    │                              │
  │ <───────────────────────────────│                              │
```

{% stepper %}
{% step %}
### Abrir la verificación

```
POST /api/v1/skin-web/auth/discord/game-session
{ "username": "Miguelki" }
```

```json
{
  "success": true,
  "verification_id": "0b3c...",
  "verification_url": "https://neobeta.miguelki.ovh/discord/verify?verification_id=0b3c...",
  "status_url": "https://neobeta.miguelki.ovh/api/pack/verify-status/0b3c...",
  "expires_at": "2026-10-18T10:00:00.000Z"
}
```

El nombre debe tener de 3 a 16 caracteres, solo letras, números y `_`.
{% endstep %}

{% step %}
### Mandar al usuario al navegador

Abre `verification_url` en el navegador del sistema. El usuario inicia sesión en Discord y el servidor vincula el nombre con esa cuenta de Discord si estaba libre.
{% endstep %}

{% step %}
### Esperar el resultado

```
GET /api/pack/verify-status/:verification_id
```

| `status` | Significado |
|---|---|
| `pending` | El usuario aún no ha terminado. Vuelve a preguntar en 2 segundos. |
| `authorized` | Listo. El ticket viene en `token`. |
| `impersonation_blocked` | Ese nombre ya pertenece a otra cuenta de Discord. |
| `expired` | La sesión ha caducado. Empieza de nuevo. |
{% endstep %}

{% step %}
### Guardar y reutilizar el ticket

El ticket vale **7 días**. Guárdalo y, antes de volver a pasar por el navegador, comprueba si sigue sirviendo:

```
POST /api/v1/skin-web/auth/discord/ticket-check
{ "username": "Miguelki", "verification_ticket": "<ticket>" }
```

```json
{ "valid": true, "username": "Miguelki", "discord_user_id": "123456789", "discord_username": "miguelki", "expires_at": "..." }
```

Si no vale responde `{ "valid": false, "reason": "invalid_or_expired" }` o `"claimed_by_other"`.

{% hint style="danger" %}
El ticket es una credencial. No lo pongas en una URL ni lo escribas en logs.
{% endhint %}
{% endstep %}
{% endstepper %}

## Escritura

Todas llevan `username` y **una** credencial: `minecraft_token` o `verification_ticket`. El ticket también se acepta en la cabecera `X-Discord-Verification-Ticket`.

### Subir una skin

```
POST /api/v1/user-textures/skin
Content-Type: multipart/form-data
```

| Campo | Valor |
|---|---|
| `username` | Nombre de la cuenta. |
| `variant` | `classic` o `slim`. |
| `minecraft_token` o `verification_ticket` | Credencial. |
| `skin_file` | PNG de 64x64 o 64x32. Máximo 2 MB. |

```bash
curl -X POST https://neobeta.miguelki.ovh/api/v1/user-textures/skin \
  -F username=Miguelki \
  -F variant=slim \
  -F verification_ticket=TU_TICKET \
  -F skin_file=@skin.png
```

Respuesta: `{ "success": true, "message": "Skin aplicada correctamente", "skin": { "url", "avatar_url", "variant", "hash" } }`.

El servidor rechaza las skins de la lista negra de moderación, tanto idénticas como muy parecidas.

### Quitar la skin

```
DELETE /api/v1/user-textures/skin
{ "username": "Miguelki", "verification_ticket": "<ticket>" }
```

### Equipar o quitar una NEOCape

```
POST /api/v1/user-textures/cape
{ "username": "Miguelki", "neocape_id": 3, "minecraft_token": "<token>" }
```

Con `"neocape_id": null` se quita la capa. `DELETE /api/v1/user-textures/cape` hace lo mismo.

### Canjear un código de capa

```
POST /api/v1/textures/neocapes/redeem-code
{ "username": "Miguelki", "code": "NEO-AB12-CD34", "verification_ticket": "<ticket>" }
```

Responde `{ "success": true, "message": "..." }`. Si el código no vale responde `400` con `success: false` y el motivo en `message`.

## Errores

Las respuestas de error traen `error` (código) y `message` (texto para mostrar al usuario, en español).

| HTTP | `error` | Qué pasó |
|---|---|---|
| 400 | `BadRequest` | Falta un campo o el nombre no es válido. |
| 400 | `InvalidSkin` | El PNG no es una skin válida. |
| 400 | `SkinBlacklisted` | Skin prohibida por moderación. |
| 401 | `Unauthorized` | No se envió credencial, o el token de Discord ha caducado. |
| 401 | `TicketInvalid` | El ticket no existe, ha caducado o es de otro nombre. |
| 403 | `Forbidden` | La credencial es válida pero no es de esa cuenta. |
| 403 | `NotLinked` | Cuenta No Premium sin vínculo de Discord. |
| 403 | `CapeRestricted` | La cuenta no tiene acceso a esa NEOCape. |
| 404 | `NotFound` | La NEOCape no existe. |
| 429 | `Too Many Requests` | Límite superado. Espera los segundos de la cabecera `Retry-After`. |

## Límites de uso

Se cuentan por IP y por minuto.

| Rutas | Límite |
|---|---|
| Todas las de skins en conjunto | 300 |
| `textures/batch`, `ticket-check` | 30 |
| Equipar o quitar capa | 20 |
| `game-session`, canjear código | 10 |

Las URLs de imagen con `?v=` se pueden cachear sin límite: el valor cambia cuando cambia la textura. Sin `?v=` el servidor pide revalidar a los pocos minutos.

## Formatos de textura

| Textura | Admitido |
|---|---|
| Skin subida | PNG 64x64 o 64x32. No se admiten GIF. |
| NEOCape | PNG o GIF animado. Proporción 2:1 (64x32, 128x64 y mayores) o cuadrada (64x64 y mayores, la capa ocupa la mitad superior). Hasta 4096x4096. |

Las NEOCapes las crea un administrador. Un jugador solo puede equipar las del catálogo.

## Integración paso a paso

Para añadir un selector de skins a tu aplicación:

{% stepper %}
{% step %}
### Muestra el estado actual

Pide `GET /api/v1/user-textures/user/:username` y pinta `skin`, o `fallback_skin` si no hay, y `cape`.
{% endstep %}

{% step %}
### Lista las capas

Pide `GET /api/v1/textures/neocapes?username=...` y deja elegir solo las que traen `can_equip: true`.
{% endstep %}

{% step %}
### Consigue la credencial

En una cuenta premium usa el token de Minecraft que ya tienes. En una No Premium recupera el ticket guardado, compruébalo con `ticket-check` y, si no vale, lanza la verificación de Discord.
{% endstep %}

{% step %}
### Guarda el cambio

Sube la skin con `POST /api/v1/user-textures/skin` o equipa la capa con `POST /api/v1/user-textures/cape`.
{% endstep %}

{% step %}
### Refresca la vista

Vuelve a pedir el estado del paso 1. Las URLs nuevas traen otro `?v=`, así que no hay que vaciar ninguna caché.
{% endstep %}

{% step %}
### Trata los errores

Muestra `message` al usuario. Con `TicketInvalid` borra el ticket guardado y repite el paso 3. Con `429` espera lo que diga `Retry-After`.
{% endstep %}
{% endstepper %}

{% hint style="info" %}
En una cuenta premium la skin se cambia en Mojang con su propia API. Aquí solo se gestionan sus NEOCapes.
{% endhint %}
