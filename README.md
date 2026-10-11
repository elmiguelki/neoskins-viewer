<p align="center"><img src="docs/.gitbook/assets/icon.png" alt="Icono de NEOLauncher" width="96"></p>

# NEOSkins Viewer

El visor 3D de skins de NEOLauncher, empaquetado para usarlo en cualquier web o launcher con webview (Electron, Tauri, CEF). Incluye un cliente de la API de NEOSkins.

- **Documentación:** https://miguelki.gitbook.io/neoskins-viewer
- **Demo y descargas:** https://elmiguelki.github.io/neoskins-viewer/

- Visor 3D con arrastre para girar.
- Contorno estilo Bedrock mediante shader.
- Antialiasing: FXAA y supermuestreo.
- Capas en PNG o GIF animado, también HD y cuadradas.
- Animaciones: reposo, gestos aleatorios y reacciones al cambiar skin o capa.
- Cliente de la API: leer texturas, subir skins, equipar NEOCapes y verificar con Discord.

## Uso rápido

```html
<div id="skin" style="width: 300px; height: 420px"></div>

<script src="https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.standalone.js"></script>
<script>
  const viewer = new NeoSkins.NeoSkinViewer("#skin");
  const client = new NeoSkins.NeoSkinsClient({ baseUrl: "https://neobeta.miguelki.ovh" });
  viewer.loadPlayer(client, "Notch");
</script>
```

Con bundler:

```bash
npm install https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer-latest.tgz
```

```ts
import { NeoSkinViewer, NeoSkinsClient } from "neoskins-viewer";
```

## Desarrollo

```bash
npm install
```

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila el módulo ES, el archivo único y los tipos en `dist/`. |
| `npm run site` | Compila y genera en `site/` la página de descargas, la demo y los archivos. |
| `npm run site:preview` | Lo anterior, y lo sirve en `http://localhost:5199`. |

El repositorio publica dos cosas:

- **Documentación.** Los Markdown de `docs/` los publica GitBook mediante su sincronización con GitHub. El sitio se describe en `gitbook-docs.yaml` y el índice en `docs/SUMMARY.md`.
- **Demo y descargas.** La carpeta `site/` se publica en GitHub Pages con cada cambio en `main`. Al subir una etiqueta `v*` se crea además una versión en GitHub con los archivos.

## Requisitos

- Navegador o webview con WebGL.
- Las imágenes de otros dominios necesitan cabeceras CORS.
- El cliente de la API también funciona en Node 18 o superior importando `neoskins-viewer/client`. El visor no.

## Licencia

[MIT](LICENSE). Puedes usar, modificar y distribuir la librería, también en proyectos comerciales. La única condición es mantener el aviso de copyright y el texto de la licencia en las copias, que es la forma de dar crédito.
