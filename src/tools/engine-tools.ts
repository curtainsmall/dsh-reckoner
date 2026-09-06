/**
 * Engine tool surface: the set / get / call primitives, solver_info
 * introspection and the record markers.
 * Thin wrapper: arguments pass schema validation then go to the engine shell; a uniform receipt (ok) is returned.
 */
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { defineJsonTool } from '../tool.ts'
import type { Engine } from '../engine/engine.ts'

declare module 'cordis' {
  interface Context {
    tools: ToolRuntime
  }
}

/** Typed-value syntax: the generic passage taught to the model (value universe). */
const VALUE_GUIDE =
  'A typed value is a JSON object: ' +
  '{ "type": "number", "value": <number>, "kind": <quantity kind>, "variant"?: <word>, "prefix"?: <word> } or ' +
  '{ "type": "complex", "value": { "re": …, "im": … } or { "mag": …, "ang": … (radians) }, "kind": <kind> } or ' +
  '{ "type": "string", "value": "…" } / { "type": "boolean", "value": true } / ' +
  '{ "type": "array", "value": [<typed values>] } / { "type": "object", "value": { <field>: <typed value> } }. ' +
  'kind is part of a quantity (resistance, voltage, time, frequency, none, …). ' +
  'variant words (degC/degF for temperature, deg for angle, bar/psi/atm for pressure, cal/Wh, hp, inch/foot/yard/mile, lb/oz) ' +
  'select a non-SI representation; omit the field for the SI base. ' +
  'prefix words: pico/nano/micro/milli/kilo/mega/giga/tera — omit for 1. ' +
  'The engine stores values as given; SI conversion happens only at calculation boundaries.'

const NAME_DESC = 'slot name: letters, digits, underscore; start with a letter or underscore'

/** Factory: binds the global single-engine instance and produces LLM-visible tool definitions. */
export function createEngineTools(engine: Engine): Array<ReturnType<typeof defineJsonTool>> {
  const solverEnum = engine.registry.ids()
  const solverList = solverEnum.length > 0 ? ` Available solver ids: ${solverEnum.join(', ')}.` : ''
  return [
    defineJsonTool({
      name: 'set',
      description: `Write one slot in the engine. ${VALUE_GUIDE} Pass value: null to delete the slot (idempotent; re-creating later restarts at rev 1). Writing a slot with a different kind than its pinned kind fails — delete the slot first (value: null) to replace it with a different kind/type.`,
      parameters: {
        name: { type: 'string', description: NAME_DESC, required: true },
        value: { type: 'json', description: 'a typed value object, a slot reference (stores a copy of the referenced slot value), or null to delete the slot', required: true },
      },
      execute: (args) => engine.opSet(args.name as string, args.value) as never,
    }),
    defineJsonTool({
      name: 'get',
      description: 'Read one slot from the engine. Returns the stored typed value exactly as written (no normalization).',
      parameters: {
        name: { type: 'string', description: NAME_DESC, required: true },
      },
      execute: (args) => engine.opGet(args.name as string) as never,
    }),
    defineJsonTool({
      name: 'call',
      description: `Call one registered solver and store its result into a named slot. Every argument must be a TYPED value ({"type": "string", "value": "rc"}, {"type": "number", "value": 100, "kind": "resistance"}, {"type": "array", "value": [...]}) or a slot reference — { "type": "slot", "value": "name" } with the full slot path; bare strings, numbers and arrays are rejected. Slot references may also sit inside array items and object fields — they resolve to the stored value before validation. The engine kind-checks arguments against the solver signature. A void solver (declared returns: null) takes target: null; a value solver requires a named target. Overwriting an existing slot replaces its value (rev +1).${solverList}`,
      parameters: {
        solver: { type: 'string', enum: solverEnum, description: 'the registered solver to call', required: true },
        args: { type: 'json', description: `solver arguments: an object mapping each parameter name to a typed value or a slot reference — run solver_info first to see each parameter's expected shape and a ready-to-send example`, required: true },
        target: { type: 'json', description: 'result slot name (string), or null for void solvers', required: true },
      },
      execute: async (args) => engine.opCall(args.solver as string, args.args as Record<string, unknown> | undefined, args.target as string | null) as never,
    }),
    defineJsonTool({
      name: 'solver_info',
      description: `Inspect one registered solver before calling it: its parameter signature (parameter names, types, quantity kinds, allowed enum values, optional flags, nested items) and its returns (spec, or null for void). Read this whenever you are about to call a solver you have not used yet.${solverList}`,
      parameters: {
        solver: { type: 'string', enum: solverEnum, description: 'the registered solver to inspect', required: true },
      },
      execute: (args) => engine.opInfo(args.solver as string) as never,
    }),
    defineJsonTool({
      name: 'record_question',
      description: 'Open a new record: clears the variable table and starts a fresh trace. Pass the consolidated question text (verbatim). If a record is already open it is sealed first (duplicate-start).',
      parameters: { text: { type: 'string', description: 'the question text', required: true } },
      execute: (args) => engine.markerQuestion(args.text as string) as never,
    }),
    defineJsonTool({
      name: 'record_analyse',
      description: 'Submit the analysis text into the open record (approach with formulas; the knowns are already stored in slots).',
      parameters: { text: { type: 'string', description: 'the analysis text', required: true } },
      execute: (args) => engine.markerAnalyse(args.text as string) as never,
    }),
    defineJsonTool({
      name: 'record_answer',
      description: 'Submit the final answer text and seal the record. With no open record it keeps a duplicate-end error record.',
      parameters: { text: { type: 'string', description: 'the answer text', required: true } },
      execute: (args) => engine.markerAnswer(args.text as string) as never,
    }),
  ]
}
