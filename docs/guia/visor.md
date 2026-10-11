---
description: Opciones, métodos y animaciones del visor.
icon: user-astronaut
---

# Uso del visor

{% hint style="info" %}
El visor ocupa el tamaño de su contenedor y lo sigue si cambia. El contenedor necesita ancho y alto.
{% endhint %}

```ts
const viewer = new NeoSkinViewer("#skin", {
  skin: "https://.../skin.png",
  model: "slim",
  cape: "https://.../cape.gif",
});

await viewer.setSkin(url, "classic"); // "classic", "slim" o "auto"
await viewer.setCape(url);            // PNG o GIF
await viewer.setCape(null);           // quitar la capa
viewer.setModel("slim");              // cambiar brazos sin recargar
viewer.play("hi");                    // lanzar una animación
viewer.dispose();                     // al cerrar la vista
```

Para previsualizar un archivo elegido por el usuario, pásalo como data URL:

```ts
const reader = new FileReader();
reader.onload = () => viewer.setSkin(reader.result as string);
reader.readAsDataURL(file);
```

## Opciones

| Opción | Por defecto | Qué hace |
|---|---|---|
| `skin`, `model`, `cape` | ninguno | Texturas iniciales. |
| `outline` | `true` | Contorno. `false` lo quita. Admite `{ thickness, brightnessBoost, brightnessOffset }`. |
| `antialias` | `true` | Pasada FXAA. |
| `pixelRatio` | el del dispositivo, máximo 2 | Supermuestreo. Más alto es más nítido y más caro. |
| `animations` | `true` | Reposo y gestos. `false` deja el modelo quieto. Admite `{ minIntervalMs, maxIntervalMs }`. |
| `reactions` | `true` | Anima `fall` al cambiar de skin y `show_cape` al cambiar de capa. |
| `rotate` | `true` | Girar arrastrando. |
| `zoom` | `false` | Zoom con la rueda. |
| `rotationY` | `0.45` | Ángulo inicial en radianes. |
| `background` | transparente | Color CSS de fondo. |
| `autoResize` | `true` | Seguir el tamaño del contenedor. |
| `width`, `height` | las del contenedor | Tamaño fijo. |
| `onCapeLoadingChange` | ninguno | Aviso mientras se descarga y decodifica una capa animada. |

## Métodos

| Método | Qué hace |
|---|---|
| `setSkin(url, model?)` | Carga una skin. |
| `setCape(url \| null)` | Carga o quita la capa. |
| `setModel("classic" \| "slim")` | Cambia el ancho de brazos. |
| `loadPlayer(client, username)` | Carga la skin y la capa que el servidor tiene para ese jugador. |
| `play(nombre)` | Lanza una animación. |
| `setOutline(activo, opciones?)` | Activa, quita o ajusta el contorno. |
| `setAntialias(activo)` | Activa o quita el FXAA. |
| `setSize(ancho, alto)` | Cambia el tamaño a mano. |
| `screenshot()` | Devuelve el fotograma actual como data URL PNG. |
| `dispose()` | Libera el contexto WebGL y quita el canvas. |

`viewer.viewer` es la instancia de `skinview3d`, por si necesitas algo que esta clase no cubre.

## Animaciones

| Nombre | Tipo |
|---|---|
| `idle_loop` | Reposo, en bucle. |
| `look`, `scratch`, `salute`, `hi` | Gestos. Sale uno al azar cada 30 a 45 segundos. |
| `fall` | Reacción al cambiar de skin. |
| `show_cape` | Reacción al cambiar de capa. |

Al terminar un gesto o una reacción, el modelo vuelve solo a `idle_loop`.

## Formatos admitidos

| Textura | El visor muestra | El servidor NEO guarda | Los mods muestran en el juego |
|---|---|---|---|
| Skin | PNG y GIF animado | Solo PNG de 64x64 o 64x32 | Solo PNG |
| Capa | PNG y GIF animado, también HD y cuadradas | PNG y GIF animado | PNG y GIF animado |

{% hint style="warning" %}
Las **capas animadas** funcionan de extremo a extremo. Las **skins animadas** solo existen en el visor: sirven para una vista previa o una web propia, pero no se pueden subir al servidor ni se ven animadas en el juego.
{% endhint %}

Una capa del servidor puede ser un GIF aunque su URL acabe en `.png`. El visor lo detecta solo por el contenido.
