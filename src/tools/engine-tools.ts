/**
 * Engine tool surface: the set / get / eval primitives and the record markers.
 * Thin wrapper: arguments pass schema validation then go to the engine shell; a uniform receipt (ok) is returned.
 *
 * Every input is a plain string. The model writes `4.7kohm` or a formula — not
 * a JSON envelope — and the engine parses it; nothing here asks the model to
 * build an object per value.
 */
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { defineJsonTool } from '../tool.ts'
import type { Engine } from '../engine/engine.ts'
import { prefixVocabulary, unitVocabulary } from '../engine/units.ts'

declare module 'cordis' {
  interface Context {
    tools: ToolRuntime
  }
}

/** Value grammar: the string forms a slot accepts. The vocabularies come from the engine's tables. */
const VALUE_GUIDE =
  'A value is ONE string, written the way it is said: "4.7kohm", "100uohm", "12volt", "1.5second", "50hertz", ' +
  '"25degC", "14.7psi", "2hp", "5" (a bare count). ' +
  `Prefixes are one letter and must be followed by a unit: ${prefixVocabulary()} (10^-12 … 10^12). ` +
  `Units and variants are full words: ${unitVocabulary()}. ` +
  'Complex: "2j", "3+4i"; scientific notation "1e5" (lowercase e only). ' +
  'Structures: "[100ohm, 220ohm]", "{v: 12volt, r: 100ohm}". ' +
  'The engine parses the string into SI and keeps the kind; the prefix and the variant word are never stored.'

const NAME_DESC = 'slot name: letters, digits, underscore; start with a letter or underscore'
const FORMAT_DESC =
  'how to print the value: a unit ("ohm"), a prefix+unit ("kohm"), a variant ("degC"), or "deg" / "rad" / "polar" / "json". Omit for the SI form ("4700ohm"). Printing never changes the stored value.'

/** The `$` vocabulary, one line per family, phrased the way the engine reports it. */
const NOTATION_GUIDE =
  'Constants: $pi $e $inf $i $j. ' +
  'Functions: $abs $sqrt $exp $ln $log $sin $cos $tan $asin $acos $atan $floor $ceil $sign $re $im $arg $conj $transpose; ' +
  'two-argument: $atan2 $min $max $mod. ' +
  'Bounded forms (subscript is the variable and its lower bound): $sum_{k=a}^{b}(body), $prod_{k=a}^{b}(body), $seq_{k=a}^{b}(body); ' +
  '$seq builds an array, which [$index] then walks. ' +
  '$integral_{a}^{b}(body, x), $diff(body, x) and $limit_{x->a}(body) can be written but NOT evaluated — use a closed form instead. ' +
  'Data access: @x[k] takes an element (the index is an expression), @th.field takes an object field (a literal name). ' +
  'Operators: + - * / ^ (multiplication always needs *, there is no implicit multiplication). ' +
  'No comparison, no logic, no conditional, no assignment. ' +
  'A bare name is a bound variable only; to read a slot write @name.'

/** Factory: binds the global single-engine instance and produces LLM-visible tool definitions. */
export function createEngineTools(engine: Engine): Array<ReturnType<typeof defineJsonTool>> {
  return [
    defineJsonTool({
      name: 'set',
      description: `Write one slot in the engine — the conditions the user gave, transcribed. ${VALUE_GUIDE} Pass value: null to delete the slot. Writing a different kind than the slot's pinned kind fails; delete the slot first (value: null) to replace it with a different kind.`,
      parameters: {
        name: { type: 'string', description: NAME_DESC, required: true },
        value: { type: 'json', description: 'one value string as above, or null to delete the slot', required: true },
      },
      execute: (args) => engine.opSet(args.name as string, args.value as string | null) as never,
    }),
    defineJsonTool({
      name: 'get',
      description: `Read one slot. Returns the value printed as text — this is the only way to read a slot, because eval does not return its value. ${FORMAT_DESC}`,
      parameters: {
        name: { type: 'string', description: NAME_DESC, required: true },
        format: { type: 'string', description: FORMAT_DESC },
      },
      execute: (args) => engine.opGet(args.name as string, args.format as string | undefined) as never,
    }),
    defineJsonTool({
      name: 'eval',
      description:
        'Evaluate ONE formula and, when target is given, store the result in that slot. ' +
        'The formula is a single expression — there is no assignment inside it: `@name` READS a slot, and `target` is the slot this call WRITES. ' +
        'Example: formula "@Vin*@R2/(@R1+@R2)" with target "Vout". ' +
        NOTATION_GUIDE +
        ' The engine derives dimensions as it evaluates: a result whose kind does not match the target slot\'s kind is refused, and so is a formula that adds a bare count to a quantity (5+@Vin) — write 5volt. ' +
        'It does not return the value — read it with `get`. ' +
        'Prefer SEVERAL eval calls over one deeply nested expression: whenever the same sub-expression appears twice, the parentheses nest more than about three deep, or the line stops being readable, evaluate the intermediate first with its own target and read it back with `@` in the next call. Each call then leaves its own formula and result in the record.',
      parameters: {
        formula: { type: 'string', description: 'the formula: one expression, referencing slots with @name', required: true },
        target: {
          type: 'json',
          description: 'the slot to write the result into (a name string), or null to evaluate without storing anything',
          required: true,
        },
      },
      execute: (args) => engine.opEval(args.formula as string, args.target as string | null) as never,
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
