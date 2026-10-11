---
description: Un selector de skins y capas completo en pocas líneas.
icon: wand-magic-sparkles
---

# Ejemplo: editor de skins

Este ejemplo muestra el estado de una cuenta, lista sus capas, previsualiza la elegida y la guarda. La función `getTicket` es la de [Cliente de la API](cliente.md#demostrar-que-la-cuenta-es-tuya).

```ts
import { NeoSkinViewer, NeoSkinsClient } from "neoskins-viewer";

const client = new NeoSkinsClient({ baseUrl: "https://neobeta.miguelki.ovh" });
const viewer = new NeoSkinViewer("#skin");

// Mostrar el estado actual de la cuenta
await viewer.loadPlayer(client, username);

// Listar las capas y previsualizar una al pulsarla
const capes = await client.listCapes(username, isPremium ? "microsoft" : "offline");
function onCapeClick(cape) {
  if (cape.can_equip) viewer.setCape(cape.file_url);
}

// Guardar la capa elegida
async function onSave(cape) {
  const credentials = isPremium
    ? { minecraftToken: accessToken }
    : { verificationTicket: await getTicket(username) };
  await client.equipCape(username, cape.id, credentials);
}
```
