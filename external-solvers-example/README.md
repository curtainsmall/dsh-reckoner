# Reckoner Echo Peer

A runnable counterpart for the Reckoner external-solver feature: an http peer that speaks the typed envelope protocol and echoes every argument back, so a register → restart → call round trip can be verified by eye.

[简体中文](README.zh-CN.md)

## Contents

- [Project](#project)
- [1. Run the peer](#1-run-the-peer)
- [2. Register the declaration](#2-register-the-declaration)
- [3. Restart the host](#3-restart-the-host)
- [4. Call it](#4-call-it)
- [5. Check the peer without the plugin](#5-check-the-peer-without-the-plugin)
- [Protocol reference](#protocol-reference)

## Project

| item | value |
|---|---|
| layout | its own npm project, with `package.json` and `tsconfig.json` |
| dependencies | none at runtime; the peer runs on the standard library |
| TypeScript | erased at run time by Node ≥ 22.18 or ≥ 23.6, so there is no build step |
| quality gate | `pnpm typecheck` in this directory, with `erasableSyntaxOnly` |
| relationship to the plugin | nothing in the plugin's `src/` references it, the plugin's build and tests do not cover it, and the npm artifact never ships it |

## 1. Run the peer

```bash
node src/echo.ts http --port 8787
# [http] echo peer listening on http://127.0.0.1:8787/
```

Or install the dev tooling once and use the script: `pnpm install` and `pnpm echo:http`.

## 2. Register the declaration

[`register-guide.md`](register-guide.md) gives the solver with the value for every field, including the `returns` editor. Add it from the panel's **External solvers** tab, or paste its `agentDeclaration` JSON into a session and let the agent call `external_solver_add`.

## 3. Restart the host

Declarations are compiled at engine start, so the solver exists after a host restart. Reload the page, and `echo_http` is among the solvers the agent can call.

## 4. Call it

Ask the agent to call `echo_http` with a `message`, an optional `values` array of numbers and an optional `flag`. The engine stores the result in the named target slot, and `get` returns exactly what the peer echoed:

```json
{
  "message": { "type": "string", "value": "round trip ok" },
  "values": { "type": "array", "value": [
    { "type": "number", "value": 1, "kind": "none" },
    { "type": "number", "value": 2.5, "kind": "none" }
  ] },
  "flag": { "type": "boolean", "value": true }
}
```

The Records panel shows the call arguments and the echoed result side by side in the trace.

## 5. Check the peer without the plugin

```bash
curl -s -X POST http://127.0.0.1:8787/ \
  -H 'content-type: application/json' \
  -d '{"requestId":"manual-1","args":{"message":{"type":"string","value":"hi"},"flag":{"type":"boolean","value":true}}}'
```

```json
{ "requestId": "manual-1", "result": { "type": "object", "value": { "message": { "type": "string", "value": "hi" }, "flag": { "type": "boolean", "value": true } } } }
```

## Protocol reference

| situation | what happens |
|---|---|
| the peer is not running | the receipt reads `fetch failed: connect ECONNREFUSED 127.0.0.1:8787`, which tells a dead peer apart from a wrong endpoint or a broken envelope |
| the response carries a different `requestId` | the host refuses it |
| the request body is not JSON | the peer answers `{ "error": "…" }` |
| the computation fails | the peer answers `{ "requestId": "…", "error": "…" }`, which the host raises as `EXTERNAL_ERROR` |

The declaration grammar, the typed-value shapes and the envelope are defined in the [engine manual](../docs/engine.md#6-external-solvers) and implemented in `src/engine/external-solvers.ts` and `src/engine/external.ts`.
