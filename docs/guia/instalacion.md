---
description: Cuatro formas de añadir el visor a tu proyecto.
icon: download
---

# Instalación

Elige la pestaña que encaje con tu proyecto. Si dudas, usa **Archivo descargado**: funciona sin conexión y no cambia sin que tú lo decidas.

{% tabs %}
{% tab title="Etiqueta script" %}
Para una página HTML sin herramientas de compilación.

{% stepper %}
{% step %}
### Crea el contenedor

El visor ocupa lo que mida su contenedor, así que dale ancho y alto.

```html
<div id="skin" style="width: 300px; height: 420px"></div>
```
{% endstep %}

{% step %}
### Carga la librería

El archivo único lo lleva todo dentro y crea el objeto global `NeoSkins`.

```html
<script src="https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer.standalone.js"></script>
```
{% endstep %}

{% step %}
### Crea el visor

```html
<script>
  const viewer = new NeoSkins.NeoSkinViewer("#skin");
  const client = new NeoSkins.NeoSkinsClient({ baseUrl: "https://neobeta.miguelki.ovh" });
  viewer.loadPlayer(client, "Notch");
</script>
```
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
Esa URL sirve siempre la última versión. Para una aplicación publicada usa mejor el archivo descargado.
{% endhint %}
{% endtab %}

{% tab title="Archivo descargado" %}
La opción recomendada para un launcher.

{% stepper %}
{% step %}
### Descarga el archivo

Baja `neoskins-viewer.standalone.js` desde [Descargas](descargas.md).
{% endstep %}

{% step %}
### Cópialo en tu proyecto

Ponlo junto a tu HTML, o en la carpeta donde guardes tus scripts.
{% endstep %}

{% step %}
### Cárgalo con una ruta local

```html
<div id="skin" style="width: 300px; height: 420px"></div>

<script src="neoskins-viewer.standalone.js"></script>
<script>
  const viewer = new NeoSkins.NeoSkinViewer("#skin");
</script>
```
{% endstep %}
{% endstepper %}
{% endtab %}

{% tab title="Paquete npm" %}
Para proyectos con Vite, webpack u otro bundler. Trae tipos de TypeScript.

{% stepper %}
{% step %}
### Instala el paquete

El paquete no está en el registro de npm. Se instala desde su archivo `.tgz`.

```bash
npm install https://elmiguelki.github.io/neoskins-viewer/downloads/neoskins-viewer-latest.tgz
```

También puedes bajar antes el archivo desde [Descargas](descargas.md) e instalarlo en local:

```bash
npm install ./neoskins-viewer-latest.tgz
```
{% endstep %}

{% step %}
### Impórtalo

```ts
import { NeoSkinViewer, NeoSkinsClient } from "neoskins-viewer";

const viewer = new NeoSkinViewer("#skin");
```
{% endstep %}
{% endstepper %}

{% hint style="info" %}
Las dependencias (`three`, `skinview3d`, `skinview3d-blockbench` y `gifuct-js`) se instalan solas.
{% endhint %}
{% endtab %}

{% tab title="Código fuente" %}
Para modificar la librería.

{% stepper %}
{% step %}
### Clona el repositorio

```bash
git clone https://github.com/elmiguelki/neoskins-viewer.git
```
{% endstep %}

{% step %}
### Instala las dependencias

```bash
cd neoskins-viewer
npm install
```
{% endstep %}

{% step %}
### Compila

```bash
npm run build
```

El resultado queda en `dist/`.
{% endstep %}

{% step %}
### Prueba la demo en local

```bash
npm run site:preview
```

Abre `http://localhost:5199/demo/`.
{% endstep %}
{% endstepper %}
{% endtab %}
{% endtabs %}

## Comprobar que funciona

Con cualquiera de las opciones, esto debe mostrar un personaje animado que se puede girar con el ratón:

```js
const viewer = new NeoSkinViewer("#skin", {
  skin: "https://mc-heads.net/skin/Notch",
});
```

Con la etiqueta script o el archivo descargado, la clase se llama `NeoSkins.NeoSkinViewer`.

## Si no aparece nada

<details>

<summary>El contenedor no tiene tamaño</summary>

Dale ancho y alto con CSS. El visor ocupa lo que mida su contenedor, y un `div` vacío mide cero de alto.

</details>

<details>

<summary>La imagen viene de otro dominio sin CORS</summary>

El servidor NEO y `textures.minecraft.net` lo permiten. Otros servidores pueden no hacerlo. La consola del navegador muestra el error.

</details>

<details>

<summary>No hay WebGL</summary>

Algunos webviews lo traen desactivado. Compruébalo abriendo la [demo](demo.md) dentro de tu aplicación.

</details>

## Siguiente paso

{% content-ref url="visor.md" %}
[visor.md](visor.md)
{% endcontent-ref %}

{% content-ref url="cliente.md" %}
[cliente.md](cliente.md)
{% endcontent-ref %}
