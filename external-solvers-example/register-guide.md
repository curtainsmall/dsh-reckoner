# Register the echo solver

Every value to type into the panel's **External solvers** form, field by field, for the peer started with `node src/echo.ts http --port 8787`. The panel re-validates on save, and the same declaration is given as JSON at the end for the agent.

[简体中文](register-guide.zh-CN.md)

## Contents

- [Identity](#identity)
- [Parameters](#parameters)
- [Returns](#returns)
- [Transport](#transport)
- [Declaration JSON](#declaration-json)
- [The wire protocol](#the-wire-protocol)

## Identity

| field | value | note |
|---|---|---|
| Name | `echo_http` | the solver id the agent calls; lowercase start, `a-z0-9_` only |
| Description | `Echo peer over http (Reckoner external-solver manual test): returns every parameter it receives, verbatim` | what the agent reads when deciding to call it |
| Enabled | on | a disabled declaration stays in the archive but does not register |

## Parameters

| name | type | required | other fields |
|---|---|---|---|
| `message` | string | yes | Description: `a text echoed back verbatim` |
| `values` | array | no | Array items: `complex`; quantity kind: `none`; Description: `values echoed back verbatim` |
| `flag` | boolean | no | Description: `a boolean echoed back verbatim` |

A quantity item is `complex` or `number`:

| item | accepts |
|---|---|
| `complex` | a real or a complex of that kind |
| `number` | a real only; a complex is refused at the argument |

## Returns

Required: a declaration without `returns` never registers. Choose type `object` and add one field per returned key:

| field name | type | other fields |
|---|---|---|
| `message` | string | |
| `values` | array | Array items: `complex`; quantity kind: `none` |
| `flag` | boolean | |

## Transport

| field | value | note |
|---|---|---|
| URL | `http://127.0.0.1:8787/` | the host POSTs the typed envelope here; `--port` moves the peer |
| Timeout (ms) | `10000` | optional; an empty field keeps the 30000 default |

## Declaration JSON

```json
{
  "name": "echo_http",
  "description": "Echo peer over http (Reckoner external-solver manual test): returns every parameter it receives, verbatim",
  "enabled": true,
  "parameters": {
    "message": { "type": "string", "description": "a text echoed back verbatim", "required": true },
    "values": { "type": "array", "items": { "type": "complex", "kind": "none" }, "description": "values echoed back verbatim" },
    "flag": { "type": "boolean", "description": "a boolean echoed back verbatim" }
  },
  "returns": {
    "type": "object",
    "fields": {
      "message": { "type": "string" },
      "values": { "type": "array", "items": { "type": "complex", "kind": "none" } },
      "flag": { "type": "boolean" }
    }
  },
  "transport": "http",
  "transportOptions": { "url": "http://127.0.0.1:8787/" },
  "timeoutMs": 10000
}
```

Paste this into a session and the agent registers it with `external_solver_add`.

## The wire protocol

| direction | body |
|---|---|
| request | `{ "requestId": "…", "args": { "message": { "type": "string", "value": "hi" }, … } }` |
| result | `{ "requestId": "…", "result": { "type": "object", "value": { … } } }` |
| failure | `{ "requestId": "…", "error": "…" }` |

The peer echoes every argument back inside an object result and wraps any argument that is not a typed value as a string. See [`src/echo.ts`](src/echo.ts) for the implementation and the [engine manual](../docs/engine.md#6-external-solvers) for the full declaration grammar.
