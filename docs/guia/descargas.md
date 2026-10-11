---
description: Todos los archivos de NEOSkins Viewer.
icon: file-arrow-down
---

# Descargas

Estos enlaces apuntan siempre a la última versión.

## Para usar en tu proyecto

| Archivo | Para qué |
| --- | --- |
| [neoskins-viewer.standalone.js](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.standalone.js) | Archivo único con todo dentro. Para una etiqueta `<script>`. |
| [neoskins-viewer-latest.tgz](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer-latest.tgz) | Paquete npm con tipos de TypeScript. Para proyectos con bundler. |
| [neoskins-client.js](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-client.js) | Solo el cliente de la API, sin visor ni dependencias. Módulo ES para navegador o Node. |
| [neoskins-viewer.js](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.js) | Módulo ES del visor, sin sus dependencias. Necesita `neoskins-client.js` en la misma carpeta. |

{% hint style="info" %}
Si no sabes cuál elegir, baja `neoskins-viewer.standalone.js`. Cómo se usa cada uno está en [Instalación](instalacion.md).
{% endhint %}

La [página de descargas](https://elmiguelki.github.io/neoskins-viewer/) muestra además la versión actual y el tamaño de cada archivo.

## Mapas de código

Sirven para depurar con las herramientas del navegador. No hacen falta para que la librería funcione.

| Archivo |
| --- |
| [neoskins-viewer.standalone.js.map](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.standalone.js.map) |
| [neoskins-viewer.js.map](https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.js.map) |

## Código fuente

* [Repositorio en GitHub](https://github.com/elmiguelki/neoskins-viewer)
* [Código en ZIP](https://github.com/elmiguelki/neoskins-viewer/archive/refs/heads/main.zip)
* [Versiones publicadas](https://github.com/elmiguelki/neoskins-viewer/releases)

## Mods para ver las skins en el juego

Las skins y capas de NEO solo se ven dentro de Minecraft con el mod NEOSkins instalado. El servidor publica la lista de versiones disponibles:

```
GET https://neobeta.miguelki.ovh/api/v1/neoskins
```

Cada entrada trae su versión de Minecraft, su loader y un `download_url` para bajar el `.jar`.
