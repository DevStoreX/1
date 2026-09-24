# Modelo justo: cómo hacer real Forja3D sin una inversión gigante

La pregunta era: *"se necesita demasiada inversión… pero debe haber otra manera"*. Sí la hay.
La clave es **no entrenar ni alojar modelos gigantes** y, en su lugar, combinar piezas que ya
existen y cobrar solo lo que realmente cuestan.

## 1. Dónde está el costo de verdad

| Pieza | Quién la paga | Costo |
|---|---|---|
| Diseñar piezas funcionales (CAD) | Tokens del modelo de lenguaje | Centavos por pieza. **$0** con un modelo local |
| Compilar, analizar y estimar | Tu computadora (WebAssembly) | $0 |
| Figuras orgánicas (tipo Meshy) | GPU del proveedor, por generación | ~$0.02 (TRELLIS) a $0.16 (Hunyuan3D 2). $0 en tu GPU |
| Vigilar la cámara | Modelo de visión o Obico | ~$0.003 por foto, o $0 con Obico/local |
| Servidor | Tu PC, una Raspberry Pi 5 o un VPS barato | $0 a $5/mes |

**Por qué Meshy y similares cobran suscripción:** mantienen GPUs encendidas para todo el mundo
y cobran por adelantado (créditos que caducan). Forja no necesita eso: la parte más útil para
inventos, el CAD paramétrico, cuesta tokens, no GPU.

### Cuentas reales de una sesión con Claude

- Contexto fijo del agente (instrucciones + 15 herramientas): ~3,700 tokens. Con el caché de
  prompts, la primera llamada cuesta ~$0.02 con Opus 5 y las siguientes ~$0.002.
- Pieza sencilla (3 llamadas, ~3,000 tokens de salida con razonamiento): **≈ $0.10** con Opus 5,
  ≈ $0.04 con Sonnet 5, ≈ $0.02 con Haiku 4.5.
- Pieza compleja con varias correcciones (8 llamadas): **≈ $0.30–0.50** con Opus 5.
- Con Ollama en tu equipo: **$0**.

Forja muestra el costo de **cada respuesta** y el total de los últimos 30 días, y permite fijar
un **límite de gasto mensual** que detiene al agente antes de pasarse.

## 2. Tres formas de usarlo, todas justas

1. **Trae tu propia clave (BYOK):** pagas directamente a Anthropic (u otro proveedor) el precio
   público, sin intermediarios ni margen.
2. **Gratis y local:** Ollama + un modelo abierto. Ideal para escuelas y para practicar.
3. **Desde tu asistente (MCP):** si ya pagas Claude, ChatGPT o Cursor, Forja les da las
   herramientas de impresión 3D sin cobrar nada más.

## 3. Si algún día se ofrece como servicio en la nube

Para las personas que no quieran instalar nada, un "Forja Cloud" puede ser justo si:

- **cobra por uso, no por suscripción**: costo del proveedor + un margen fijo y visible
  (por ejemplo 15 %) mostrado en cada acción;
- **no hay créditos que caducan**: el saldo no vence;
- tiene un **nivel gratuito** con modelos abiertos para niños y escuelas;
- el código sigue siendo abierto: cualquiera puede alojarlo, y eso obliga a mantener precios justos.

## 4. Cómo se sostiene el proyecto sin inversión grande

- **Comunidad y código abierto:** conectores, traducciones y diseños los aporta la comunidad.
- **Patrocinios educativos:** fundaciones, alcaldías y ministerios de educación financian
  talleres "de la idea a la pieza" en colegios. El software ya está hecho y es gratis.
- **Alianzas con tiendas de filamento e impresoras:** Forja recomienda materiales y perfiles;
  una alianza transparente (divulgada) puede financiar desarrollo sin cobrar a los usuarios.
- **Servicios propios:** talleres, impresión bajo pedido, diseño a medida con la ayuda del agente.
- **Biblioteca de "inventos" paramétricos** (hoja de ruta): diseños con licencia clara, donde el
  autor decide si se venden y recibe la mayor parte del ingreso.

## 5. Para quien quiere vender lo que imprime

La calculadora incluye material, electricidad, desgaste de la máquina, mantenimiento, tu tiempo,
un colchón por fallos, comisiones de la plataforma e impuestos, y sugiere tres niveles:
*precio justo* (amigos, escuelas), *venta local* y *tienda en línea*.

**Respeta las licencias:** un diseño descargado con licencia *no comercial* (CC BY-NC) no se
puede vender. Forja siempre propone un **diseño propio** basado en la función del objeto, no una
copia. Si el mecanismo tiene una patente vigente, consulta antes de comercializarlo.

## Fuentes de precios (septiembre de 2026)

- Planes y créditos de Meshy: <https://www.meshy.ai/pricing>, <https://www.meshy.ai/tutorials/meshy-credits-guide>
- Servidor MCP de Meshy: <https://www.meshy.ai/mcp>
- TRELLIS en fal.ai: <https://fal.ai/models/fal-ai/trellis/api>
- Hunyuan3D en fal.ai: <https://fal.ai/models/fal-ai/hunyuan3d/v2>
- Comparativa de APIs de generación 3D: <https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026>
- Precios de Claude: <https://www.anthropic.com/pricing>
