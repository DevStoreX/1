# Cómo contribuir

¡Gracias por ayudar a que imprimir en 3D sea fácil para todos!

## Ramas

| Rama | Para qué |
|---|---|
| `main` | Versión estable. Solo recibe cambios desde `develop` cuando se publica una versión. |
| `develop` | Integración: aquí llegan los pull requests. |
| `feature/<nombre>` | Una funcionalidad nueva (p. ej. `feature/conector-creality-cloud`). |
| `fix/<nombre>` | Una corrección. |
| `docs/<nombre>` | Documentación o traducciones. |

1. Crea tu rama desde `develop`: `git checkout -b feature/mi-idea develop`
2. Haz commits pequeños y descriptivos (en español o inglés).
3. Antes de abrir el PR: `npm run typecheck && npm test && npm run build`
4. Abre el pull request hacia `develop` explicando **qué** cambia y **por qué**.

## Preparar el entorno

```bash
npm install
npm run dev        # API en :8787 + interfaz en http://localhost:5173
npm test           # pruebas
```

No hace falta clave de IA para las pruebas: usan proveedores simulados.

## Ideas donde ayudar

- **Probar con tu impresora real** y reportar qué funciona (especialmente Bambu Lab y PrusaLink).
- **Diseños de ejemplo** en `examples/`: con parámetros Customizer y comentarios. La prueba
  `examples.test.ts` verifica que compilen, sean cerrados y se impriman sin soportes.
- **Conectores nuevos** en `packages/core/src/printers/` (implementan `PrinterConnector`).
- **Traducciones** en `apps/web/src/i18n.ts`.
- **Mejorar el prompt de diseño** en `packages/agent/src/prompts.ts` (con ejemplos de antes y después).

## Estilo

- TypeScript estricto, ESM, sin dependencias innecesarias.
- Comentarios y mensajes para la persona usuaria en español; nombres de código en inglés.
- Todo cambio de comportamiento viene con su prueba.

## Seguridad

Si encuentras una vulnerabilidad, no abras un issue público: escribe a la persona responsable del
repositorio para acordar la corrección.
