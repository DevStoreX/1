# Usar Forja3D desde tu asistente de IA (MCP)

Forja expone sus herramientas por el **Model Context Protocol (MCP)**. Tu asistente escribe el
diseño y Forja lo compila, lo analiza, calcula el precio y habla con tus impresoras. Así usas la
suscripción que ya tienes, sin pagar nada extra.

Herramientas: `create_model`, `update_model`, `get_model`, `list_models`, `analyze_model`,
`estimate_price`, `search_models`, `generate_organic_mesh`, `list_printers`, `printer_control`,
`send_to_printer`, `check_camera`, `set_camera_monitor`, `reference_data` y `open_example`. El servidor incluye
instrucciones con las reglas de diseño para impresión FDM, así que cualquier asistente diseña
con buenas prácticas.

Cada modelo creado incluye `viewer_url` (ábrelo en la interfaz web de Forja) y `stl_url` (descarga).

## Claude Code

Con el servidor web de Forja en marcha (`npm start`):

```bash
claude mcp add --transport http forja3d http://localhost:8787/mcp
```

O por stdio, sin servidor web:

```bash
claude mcp add forja3d -- npx -y tsx /ruta/a/forja3d/apps/mcp/src/index.ts
```

## Claude Desktop

*Ajustes → Desarrollador → Editar configuración* (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "forja3d": {
      "command": "npx",
      "args": ["-y", "tsx", "/ruta/a/forja3d/apps/mcp/src/index.ts"]
    }
  }
}
```

En Windows usa rutas como `C:\\Users\\tu-usuario\\forja3d\\apps\\mcp\\src\\index.ts`.

## Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forja3d": { "url": "http://localhost:8787/mcp" }
  }
}
```

## VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "forja3d": { "type": "http", "url": "http://localhost:8787/mcp" }
  }
}
```

## ChatGPT y otros asistentes en la nube

Los asistentes web necesitan una URL **pública con HTTPS**:

1. Arranca Forja con token: `FORJA_TOKEN=un-secreto-largo npm start`.
2. Publícalo con un túnel (por ejemplo `cloudflared tunnel --url http://localhost:8787`).
3. En el asistente, añade un conector MCP personalizado con `https://tu-tunel.example/mcp` y la
   cabecera `Authorization: Bearer un-secreto-largo`.

> ⚠️ Con el túnel abierto, cualquiera que tenga el token puede controlar tus impresoras. Usa un
> token largo y cierra el túnel cuando no lo uses.

## Datos compartidos

El servidor MCP por stdio y el servidor web usan la misma carpeta de datos (`~/.forja3d` o
`FORJA_DATA_DIR`). Lo que diseñes desde Claude aparece en *Mis modelos* de la interfaz web.
