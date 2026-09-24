# Conectar tu impresora

Ve a **Impresoras → Añadir impresora**, elige el tipo, completa los datos y pulsa
**Probar conexión**. Forja guarda las contraseñas y códigos solo en tu servidor.

> Forja envía archivos **laminados** (`.gcode`, `.bgcode`, `.3mf`). Lamina el STL en tu programa
> de siempre (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura) y súbelo en el panel del modelo con
> **Subir G-code/3MF laminado**. Después usa **Enviar a impresora**, o pídeselo al agente.
> Si instalas PrusaSlicer, define `FORJA_SLICER_BIN` (y `FORJA_SLICER_CONFIG` con tu perfil `.ini`)
> para que Forja lamine automáticamente.

## Bambu Lab (A1, A1 mini, P1P, P1S, P2S, X1C, H2D)

1. En la pantalla de la impresora: **Ajustes → Red → Modo solo LAN** (LAN Only Mode) → activar.
2. En firmwares recientes activa también **Modo desarrollador** (Developer Mode). Sin él, Bambu
   bloquea el control por parte de programas de terceros.
3. Anota la **IP**, el **número de serie** (Ajustes → Dispositivo) y el **código de acceso** que
   aparece en la pantalla de red.
4. En Forja: tipo *Bambu Lab*, pega los tres datos y elige el modelo.

- Estado y control por MQTT (puerto 8883), subida por FTPS (puerto 990).
- Cámara: A1/P1 funciona directo (puerto 6000). X1/H2D usan RTSP: instala `ffmpeg`, o construye la
  imagen Docker con `--build-arg WITH_FFMPEG=true`.
- Para imprimir, sube el `.gcode.3mf` exportado desde Bambu Studio u OrcaSlicer ("Exportar archivo de plato laminado").
- Nota: el modo LAN desconecta la app Bambu Handy en la nube. Es un compromiso de Bambu, no de Forja.

## Prusa (MK4, MK4S, CORE One, MINI+, XL)

1. En la impresora: **Ajustes → Red → PrusaLink** → activar. Anota la IP, el usuario (normalmente
   `maker`) y la contraseña que muestra.
2. En Forja: tipo *Prusa (PrusaLink)*, URL `http://IP`, usuario y contraseña (o una API key).
3. Los archivos se guardan en la memoria USB (`usb`). Sube `.bgcode` o `.gcode` laminado con PrusaSlicer.
4. Cámara: si tienes una cámara con URL JPEG/MJPEG, pégala en *URL de cámara*.

## Klipper (Moonraker: Mainsail, Fluidd, Creality K1/K2, Elegoo Neptune 4, Voron…)

1. URL de Moonraker, normalmente `http://IP:7125` (o `http://IP` si tu interfaz la redirige).
2. Si activaste autorización en Moonraker, crea una API key y pégala.
3. La cámara se detecta automáticamente desde las webcams configuradas en Moonraker.

## OctoPrint (Ender, Anycubic, Artillery y casi cualquier impresora con USB)

1. En OctoPrint: **Ajustes → Application Keys** (o API) → genera una clave.
2. En Forja: URL `http://octopi.local` (o la IP) y la API key.
3. La cámara usa `/webcam/?action=snapshot` o la URL que indiques.

## Impresora simulada

Sirve para probar Forja sin hardware: simula el ciclo de impresión (imprimir, pausar, reanudar, cancelar).

---

# Cámara con IA

Forja toma una foto de la cámara y la revisa buscando: espagueti, pieza despegada o movida,
grumos en la boquilla, desplazamiento de capas, impresión en el aire, falta de filamento,
warping severo, soportes caídos, humo o fuego.

- **Revisar con IA:** una revisión puntual (botón en la tarjeta de la impresora, o pídeselo al agente).
- **Vigilancia automática:** revisa cada 30 s a 5 min **solo mientras imprime**. Si detecta un
  fallo con confianza ≥ 60 % **dos veces seguidas**, pausa la impresión y te avisa (así se
  evitan pausas por falsas alarmas).

## Detectores disponibles

| Detector | Costo | Calidad | Configuración |
|---|---|---|---|
| Claude Haiku 4.5 (por defecto) | ≈ $0.003 por foto (≈ $0.18/hora cada 60 s) | Muy buena, explica qué ve | Ajustes → Cámara con IA |
| Modelo local con visión (Ollama, p. ej. `qwen2.5vl:7b`) | $0 | Buena con GPU | Proveedor de visión: Ollama |
| [Obico](https://github.com/TheSpaghettiDetective/obico-server) `ml_api` | $0 | Especializado en espagueti | Levanta `ml_api` de Obico y pon su URL. En Docker, Forja expone las capturas en `FORJA_INTERNAL_URL` |

La cámara debe ver bien la cama con luz suficiente. Si la imagen está oscura o borrosa, el
detector responde "desconocido" en lugar de inventar.
