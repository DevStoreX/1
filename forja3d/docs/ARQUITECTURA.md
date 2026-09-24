# Arquitectura

```
                ┌──────────────────────────── apps/web (React + three.js) ───────────────────────────┐
                │  Chat · Visor 3D · Controles de medidas · Impresoras · Precios · Ajustes           │
                └───────────────┬────────────────────────────────────────────────────────────────────┘
                                │ REST + SSE (/api)
┌───────────────────────────────▼──────────────────────── apps/server (Hono) ─────────────────────────┐
│  /api/chat (SSE) → runAgent()   /api/models   /api/printers   /api/settings   /mcp (MCP por HTTP)   │
└───────┬─────────────────────────────────────────────────────────────────────────────────────┬───────┘
        │                                                                                     │
┌───────▼──────────── packages/agent ─────────────────────┐        apps/mcp (stdio) ──────────┤
│  Proveedores: AnthropicProvider (SDK oficial)            │        mismas herramientas        │
│              OpenAICompatibleProvider (Ollama, LM Studio)│                                   │
│  Bucle del agente · 15 herramientas (zod) · Prompt       │                                   │
│  ModelService (crear/editar/importar/estimar)            │                                   │
└───────┬──────────────────────────────────────────────────┘                                   │
        │                                                                                      │
┌───────▼──────────────────────────── packages/core ───────────────────────────────────────────▼──────┐
│ cad/       OpenSCAD en WebAssembly (Manifold) en hilos con límite de tiempo · parámetros Customizer │
│ geometry/  STL · GLB · OBJ · análisis de imprimibilidad · transformaciones                          │
│ print/     materiales · perfiles de impresoras · estimación · precio justo · G-code · laminador CLI │
│ printers/  OctoPrint · Moonraker · PrusaLink · Bambu (MQTT/FTPS/cámara) · simulada                  │
│ camera/    detector por visión · Obico · monitor con pausa automática                               │
│ gen3d/     TRELLIS / Hunyuan3D (fal.ai) · Hunyuan3D local                                           │
│ search/    enlaces a repositorios · API de Thingiverse                                              │
│ store/     archivos JSON en ~/.forja3d (modelos, impresoras, ajustes, conversaciones, consumo)      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Decisiones clave

**CAD paramétrico con OpenSCAD.** Los modelos de lenguaje escriben OpenSCAD muy bien (hay
muchísimo código público), el resultado es exacto y editable, y los parámetros *Customizer* se
convierten en controles deslizantes. Para inventos y piezas funcionales es mejor que una malla
generada por difusión: se puede medir, ajustar la holgura y reimprimir.

**Motor Manifold en WebAssembly.** Usamos `@lofcz/openscad-wasm` (OpenSCAD 2026.09 con
Manifold): una pieza con 21 cilindros tarda 0.46 s, frente a 87 s con el motor CGAL antiguo.
Corre aislado (sin acceso al disco), en hilos (`worker_threads`) con límite de tiempo, y no hace
falta instalar nada. Si prefieres el binario nativo, define `OPENSCAD_BIN`.

**El análisis cierra el ciclo.** Tras cada compilación, Forja devuelve al agente si la malla es
cerrada, el porcentaje de voladizos, el área de apoyo y si cabe en la impresora. El agente lo
lee y corrige el diseño antes de dártelo.

**Proveedor de IA intercambiable.** Claude con el SDK oficial (pensamiento adaptativo, caché de
prompts, búsqueda web, reserva del servidor) y cualquier servidor compatible con
`/chat/completions` para modelos abiertos. La conversación se guarda en formato neutro y, con
Claude, se reenvía el contenido nativo sin modificar (bloques de pensamiento incluidos). El
historial solo crece: nunca se editan turnos anteriores.

**Contexto estable y barato.** El prompt del sistema y las herramientas no cambian entre turnos
(caché de prompts); el contexto variable (modelo abierto, impresoras, modo niños) va al principio
del mensaje de la persona.

**Local primero.** Sin base de datos ni servicios obligatorios. Todo vive en `~/.forja3d`.
Escucha en `127.0.0.1` salvo que se configure lo contrario, con token opcional.

## Flujo de un mensaje

1. La interfaz envía `POST /api/chat` con el texto, las fotos (reducidas a 1280 px) y el modelo abierto.
2. El servidor antepone el contexto de la app y llama a `runAgent()`.
3. El agente transmite el texto por SSE. Cuando pide herramientas, se validan con zod y se
   ejecutan en paralelo. Los resultados vuelven al modelo en un solo mensaje.
4. `create_model`/`update_model` compilan y analizan. La interfaz recibe el evento `model` y
   carga el STL en el visor.
5. Cada llamada registra tokens y costo en `usage.json`. Se respeta el presupuesto mensual.

## Pruebas

`npm test` ejecuta más de 60 pruebas: geometría y análisis, parámetros, compilación real con
OpenSCAD (incluidos bucles infinitos y texto), ejemplos imprimibles sin soportes, conectores con
respuestas simuladas (OctoPrint, Moonraker, PrusaLink con Digest), monitor de cámara, generación
3D con fal simulada, bucle del agente, proveedores (Claude y compatible), servidor de punta a
punta con un proveedor de IA falso, y MCP por HTTP.
