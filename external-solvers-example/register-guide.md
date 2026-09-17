# Registering the Example Solvers

The peer must be running first (`node src/echo.ts http --port 8787`). In the
plugin's Records panel open the **External solvers** tab and click **Add
external solver**, then fill the dialog with the values below. Changes apply
after a host restart.

Alternatively, ask the agent in a session to register the solver and paste
the solver's `agentDeclaration` JSON; the agent calls `external_solver_add`.

## echo_http

| Dialog field | Enter | Note |
|---|---|---|
| Name | `echo_http` | the solver name the agent will call; starts lowercase, `a-z0-9_` only |
| URL | `http://127.0.0.1:8787/` | the only transport: the host POSTs the typed envelope here; `--port` overrides 8787 |
| Timeout (ms) | `10000` | optional; empty keeps the 30000 default |
| Description | `Echo peer over http (ElectroLab external-solver manual test): returns every parameter it receives, verbatim` | what the agent reads to decide when to call the solver |
| Enabled | on | a disabled declaration is kept but not registered |

Parameters — click **Add parameter** once per row:

| Name | Type | Required | Other fields |
|---|---|---|---|
| `message` | string | yes | Description: `a text echoed back verbatim` |
| `values` | array | no | Array items: `quantity` · Quantity kind: `none` · Description: `values echoed back verbatim` |
| `flag` | boolean | no | Description: `a boolean echoed back verbatim` |

Returns — the **Returns** section (required; a declaration without it never
registers): type `object`, then add one field per returned key:

| Field name | Type | Other fields |
|---|---|---|
| `message` | string | |
| `values` | array | Array items: `number` · Quantity kind: `none` |
| `flag` | boolean | |

`agentDeclaration`:

```json
{
  "name": "echo_http",
  "description": "Echo peer over http (ElectroLab external-solver manual test): returns every parameter it receives, verbatim",
  "enabled": true,
  "parameters": {
    "message": { "type": "string", "description": "a text echoed back verbatim", "required": true },
    "values": { "type": "array", "items": { "type": "quantity", "kind": "none" }, "description": "values echoed back verbatim" },
    "flag": { "type": "boolean", "description": "a boolean echoed back verbatim" }
  },
  "returns": {
    "type": "object",
    "fields": {
      "message": { "type": "string" },
      "values": { "type": "array", "items": { "type": "number", "kind": "none" } },
      "flag": { "type": "boolean" }
    }
  },
  "transport": "http",
  "transportOptions": { "url": "http://127.0.0.1:8787/" },
  "timeoutMs": 10000
}
```

## The wire protocol, at a glance

```
request:  { "requestId": "…", "args": { "message": { "type": "string", "value": "hi" }, … } }
response: { "requestId": "…", "result": { "type": "object", "value": { "message": { "type": "string", "value": "hi" }, … } } }
failure:  { "requestId": "…", "error": "…" }
```

The peer echoes every argument back as a typed value inside an object
result; values that are not typed values are wrapped as strings. See
the plugin's engine sources (`src/engine/external-solvers.ts` and
`src/engine/external.ts`) for the full protocol.
