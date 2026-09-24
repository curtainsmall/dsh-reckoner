/**
 * The model-facing tool surface: the three engine primitives and the three
 * record markers. Each one is a thin call into the engine, which answers with
 * the receipt the model reads.
 */
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { defineJsonTool } from '../tool.ts'
import { notationVocabulary } from '../engine/notation.ts'
import { allSiNames, SI_COMPONENT_ORDER } from '../engine/si-vector.ts'
import type { Engine } from '../engine/engine.ts'
import { TraceTool } from '../engine/trace-tools.ts'

declare module 'cordis' {
  interface Context {
    tools: ToolRuntime
  }
}

const NAME_DESCRIPTION = 'slot name: letters, digits and underscore, starting with a letter or underscore'

const VALUE_DESCRIPTION =
  'the value: a tagged object carrying exactly one of {"num": x} (a real), {"re": x, "im": y} or ' +
  '{"mag": r, "ang": theta} (a complex; theta is radians), {"array": [...]} (an array) or {"object": {...}} ' +
  '(named fields). "dim" travels with the value: one of the SI names, or 7 integers in the order ' +
  `${SI_COMPONENT_ORDER}; omitted means the zero SI vector. Array elements are bare numbers, {re,im} or nested ` +
  "arrays, all sharing the array's dimension; an object carries one dimension per field and no dimension of its own. A complex " +
  'is stored rectangular, so a polar input is converted on the way in. Pass null to delete the slot.'

const DIM_DESCRIPTION =
  `how to read the value: one of the SI names, or 7 integers in the order ${SI_COMPONENT_ORDER} to check the ` +
  'vector without converting. Omit it to read the stored SI value.'

const DIGITS_DESCRIPTION = 'significant digits to keep (a positive integer); omitted means the raw float'

const FORM_DESCRIPTION =
  'the form to read: "rect" for {re,im} or "polar" for {mag,ang} in radians; a real is widened to a complex. Omitted keeps the stored form.'

const NOTATION_DESCRIPTION =
  `The notation is: ${notationVocabulary()}. Constants are written bare ($pi, $e^(2) for a power); functions take ` +
  'parentheses ($abs(x), $atan2(y, x)); the bounded forms take their bounds as positions ' +
  '($sum_{k=a}^{b}(body), $prod_{k=a}^{b}(body), $seq_{k=a}^{b}(body) building an array, ' +
  '$integral_{a}^{b}(body, x) or $integral(body, x), $limit_{x->a}(body), $diff(body, x) or $diff(body, x, n)); ' +
  '$integral, $limit and $diff can be written but not evaluated. Slots are read with @name, an array element with ' +
  '@name[index] and an object field with @name.field. Multiplication always needs "*". An exponent must be a pure ' +
  'number, and only a dimensionless base takes a complex exponent.'

const RECORD_DESCRIPTION = 'set, get and eval are refused while no record is open.'

/** Factory: binds the process-wide engine and produces the LLM-visible tool definitions. */
export function createEngineTools(engine: Engine): Array<ReturnType<typeof defineJsonTool>> {
  return [
    defineJsonTool({
      name: TraceTool.Set,
      description:
        'Write one slot: each quantity the user gave, transcribed. The engine converts nothing by itself - write ' +
        `the value in SI and let "dim" name the quantity. The accepted names are ${allSiNames().join(', ')}. ` +
        `${VALUE_DESCRIPTION} The receipt echoes what was stored: the "dim" as 7 integers, a complex as "re" and "im".`,
      parameters: {
        name: { type: 'string', description: NAME_DESCRIPTION, required: true },
        value: { type: 'json', description: VALUE_DESCRIPTION, required: true },
      },
      execute: (args) => engine.opSet(args.name as string, args.value) as never,
    }),
    defineJsonTool({
      name: TraceTool.Get,
      description:
        `Read one slot: the only way to read a value, because eval does not return one. ${DIM_DESCRIPTION} ` +
        `${FORM_DESCRIPTION} ${DIGITS_DESCRIPTION}. The receipt is the value in the tagged shape, so it can be fed straight back to set.`,
      parameters: {
        name: { type: 'string', description: NAME_DESCRIPTION, required: true },
        form: { type: 'string', description: FORM_DESCRIPTION },
        digits: { type: 'number', description: DIGITS_DESCRIPTION },
        dim: { type: 'json', description: DIM_DESCRIPTION },
      },
      execute: (args) => engine.opGet(args.name as string, { form: args.form, digits: args.digits, dim: args.dim }) as never,
    }),
    defineJsonTool({
      name: TraceTool.Eval,
      description:
        'Evaluate ONE formula and write the result into the target slot. The formula is a single expression: there ' +
        'is no assignment inside it, no statement sequence and no comparison - @name READS a slot, and target is ' +
        `the slot this call WRITES. ${NOTATION_DESCRIPTION} The engine derives dimensions while it evaluates: ` +
        'adding two different vectors, a fractional vector landing in a slot, or a dimensionless base under a ' +
        'complex exponent are all refused with the vectors spelled out. The receipt is {ok, target, rev} - read the ' +
        'value back with get. Prefer several eval calls over one deep expression: give each intermediate its own ' +
        'target, then read it with @name in the next call.',
      parameters: {
        formula: { type: 'string', description: 'the formula: one expression, reading slots with @name', required: true },
        target: { type: 'string', description: 'the slot the result is written into', required: true },
      },
      execute: (args) => engine.opEval(args.formula as string, args.target as string) as never,
    }),
    defineJsonTool({
      name: TraceTool.Start,
      description:
        'Open a record: it carries this calculation from here on and is written to disk when it closes. Pass a short ' +
        'title - about the length of an article title, not a paragraph; the record is listed and the article is ' +
        `titled by it. ${RECORD_DESCRIPTION} It fails when a record is already open - close that one with record_end first.`,
      parameters: {
        title: { type: 'string', description: 'a short title for the calculation', required: true },
      },
      execute: (args) => engine.markerStart(args.title as string) as never,
    }),
    defineJsonTool({
      name: TraceTool.Message,
      description:
        'Write one piece of explanation into the open record: what happens, what was found, why a step is taken. ' +
        'Call it as often as the work needs - one message per thought, several in a row when the record is long. ' +
        'Set hide:true only for notes the user need not read (conventions, writing guidance, what to emphasise ' +
        `later); hidden messages are only shown on request, while results and reasoning stay visible. ${RECORD_DESCRIPTION}`,
      parameters: {
        text: { type: 'string', description: 'the explanation text', required: true },
        hide: { type: 'boolean', description: 'hide this message from the record view (default false)' },
      },
      execute: (args) => engine.markerMessage(args.text as string, args.hide) as never,
    }),
    defineJsonTool({
      name: TraceTool.End,
      description:
        'Close the open record, optionally with a closing text (the conclusion the user should read). The record ' +
        'becomes readable and can be written up as an article. It fails when no record is open - the receipt is the ' +
        'only thing written, nothing reaches the disk.',
      parameters: {
        text: { type: 'string', description: 'the closing text, if any' },
      },
      execute: (args) => engine.markerEnd(args.text) as never,
    }),
  ]
}
