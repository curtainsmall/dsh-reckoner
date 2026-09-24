---
name: reckoner-interface
description: The Reckoner engine manual - values, tools, receipts, notation and the dimension rules. Read before writing any formula.
whenToUse: Load before the first Reckoner tool call of a calculation, and again whenever a formula, a receipt or the engine's dimension rules are unclear.
---

# Reckoner engine manual

The engine is a calculator with no domain knowledge: you write the formula, it parses, substitutes, checks the dimensions, evaluates and records. Everything below is engine behaviour, not advice.

## Values

A slot holds one of four value types: `number` (a JSON number), `complex` (stored rectangular as `re`/`im`), `array` (one SI vector for the whole array) and `object` (one vector per field). A quantity is a number plus a 7-integer SI vector; the vector is the whole identity, and the name is only how it is written.

`set` takes a tagged object with exactly one tag:

- `{"num": 4.7e3, "dim": "ohm"}` - a real
- `{"re": 3, "im": 4, "dim": "ohm"}` - a complex in rectangular form
- `{"mag": 5, "ang": 0.927295218, "dim": "ohm"}` - polar, radians; converted to rectangular on the way in
- `{"array": [1, 2, 3], "dim": "volt"}` - an array whose elements are bare numbers, `{re,im}` or nested arrays, sharing the array's `dim`
- `{"object": {"v": {"num": 12, "dim": "volt"}}}` - named fields, each a full value with its own `dim`; an object takes no `dim` of its own

`dim` is a name from the SI table, 7 integers in the order `m,kg,s,A,K,mol,cd`, or omitted for the zero vector. `value: null` deletes the slot, idempotently. Only whole SI vectors can be stored: a fractional vector, from `$sqrt` or a fractional power, is refused when it lands in a slot.

## Tools

### `set {name, value}`

Writes one slot. The receipt echoes what was stored: `dim` always as 7 integers, a complex always as `re`/`im`, an array with one `dim`, an object field by field.

### `get {name, form?, digits?, dim?}`

Reads one slot. Its `value` can be fed straight back into `set`.

| parameter | value | effect |
|---|---|---|
| `form` | `"rect"` | `{re,im}` |
| | `"polar"` | `{mag,ang}`, radians |
| | omitted | keeps the stored form |
| `digits` | an integer | at most that many significant digits (4700 has 4), never padding |
| `dim` | a name | convert into that spelling |
| | 7 integers | check the vector without converting; a mismatch is refused |

A real is widened to a complex on request: `rect` gives `{re:x, im:0}`, `polar` gives `{mag:|x|, ang:0}` and `pi` for a negative real.

### `eval {formula, target}`

Evaluates ONE expression and writes the result into `target`, a required slot name. The receipt is `{ok, target, rev}`; `eval` does not return the value, so read it with `get`.

### `search {question}`

Looks one fact up outside the calculation. It exists only in the `reckoner-with-search` preset; in the pure preset it is not part of the surface, so never call it there. Ask for the fact the way you would ask a colleague ("thermal conductivity of copper at 300 K").

The receipt is `{ok, answer, origin}` or `{ok: false, code, error}`. You receive the answer as words, never the pages, the queries or the sources: those go into the record, with the route and the prompt version that produced them.

- The answer is an INPUT: transcribe it with `set`, copying the number with the unit exactly as written, and let the engine convert.
- Never ask it to compute, convert, round or derive anything, and never ask for something the record already holds.
- `SEARCH_INSUFFICIENT`: no allowed source holds the fact. That quantity is missing, so say which relation cannot be evaluated and stop.
- `SEARCH_BUDGET_EXCEEDED`: the record has spent its lookups. Continue with what the record holds, or state what is missing.
- `SEARCH_UNAVAILABLE`: a technical failure; it changes nothing.

## Receipts and errors

Every call answers `{ok: true, ...}` or `{ok: false, code, error}`. A failure writes nothing: no slot changes, and the trace records the failure row. `error` is written for you, and carries the concrete value, the boundary or the expectation, and the fix; `code` is a stable identifier, useful in logs and tests.

| code | cause |
|---|---|
| `ENGINE_INVALID_FORMULA` | the formula does not parse |
| `ENGINE_INVALID_NUMBER` | a malformed number literal |
| `ENGINE_INVALID_IDENTIFIER` | a name outside the table used as a slot |
| `ENGINE_INVALID_DIMENSION` | `dim` is neither a table name nor 7 integers |
| `ENGINE_INVALID_NOTATION` | the `$` notation is written wrongly |
| `ENGINE_INVALID_ARITY` | a notation with the wrong number of arguments |
| `ENGINE_SLOT_NOT_FOUND` | `@name` names no slot |
| `ENGINE_NAME_NOT_BOUND` | a bare name has no binding |
| `ENGINE_INCOMPATIBLE_DIMENSION` | two vectors must match, or an argument must be dimensionless |
| `ENGINE_UNSUPPORTED_OPERATION` | the operation does not exist between these operands |
| `ENGINE_INVALID_INDEX` | an index is not an integer with the zero vector |
| `ENGINE_UNDEFINED_RESULT` | the result is undefined here |
| `ENGINE_UNSUPPORTED_INDEX` | the index form is not supported |
| `ENGINE_FIELD_NOT_FOUND` | the object has no such field |
| `ENGINE_UNSUPPORTED_SYMBOL` | the notation is writable but not evaluable |
| `ENGINE_INVALID_ARGS` | a tool's arguments are invalid |
| `ENGINE_OPEN_RECORD_NOT_FOUND` | no record is open |
| `ENGINE_OPEN_RECORD_FOUND` | a record is already open |
| `ENGINE_UNKNOWN_ERROR` | no more specific code applies |

## Record markers

| marker | effect | failure |
|---|---|---|
| `record_start {title}` | opens a record | a record is open |
| `record_message {text, hide?}` | one explanation, any number, any order | none |
| `record_end {text?}` | closes the record and writes it to disk | no record is open |

- `hide: true` keeps the message out of the record view, and still gives it to the article writer.
- `set`, `get` and `eval` are refused while no record is open.
- Closing clears the slot table, so a new record starts empty.
- Each marker answers `{ok}`; a refused one carries `ENGINE_OPEN_RECORD_FOUND` or `ENGINE_OPEN_RECORD_NOT_FOUND`.

## Notation

Constants: `$pi` `$e` `$inf` `$i` `$j`.

Unary functions: `$abs` `$sqrt` `$exp` `$ln` `$log` `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$floor` `$ceil` `$sign` `$re` `$im` `$arg` `$conj` `$transpose` `$len`.

Two-argument functions: `$atan2` `$min` `$max` `$mod`.

Bounded forms: `$sum_{k=a}^{b}(body)`, `$prod_{k=a}^{b}(body)` and `$seq_{k=a}^{b}(body)` evaluate; `$integral_{a}^{b}(body, x)` or `$integral(body, x)`, `$limit_{x->a}(body)`, `$diff(body, x)` or `$diff(body, x, n)` can be written but not evaluated.

- Both bounds are required, integers with the zero vector, inclusive, and they are evaluated once before the body.
- `$seq` builds an array; nested `$seq` builds a row-major two-dimensional array.
- `$transpose(M)` takes a two-dimensional array and leaves the vector unchanged; `$len(array)` counts elements and is itself a usable bound.
- A position is the brace directly after the notation name, `_{k=a}` or `^{N}`. Every other `^` is a power, so `$e^(2)` and `$pi^2` are powers while `$pi^{2}` is refused. A bound expression holds no loop variable: `^{N-1}` is an unbound name, so write `^{@N-1}`.

Slots are read as `@name`, an array element as `@name[index]` (an expression, an integer with the zero vector), an object field as `@name.field`, and these chain: `@net.ports[0].z`. A bare name is a bound variable only.

- **Operators**: `+ - * / ^` with brackets
- **Precedence**: additive, multiplicative, unary, power, postfix, primary
- **Associativity**: `^` is right-associative, and `-2^2` is `-4`
- **Multiplication**: must be written, as `2*@R`, never `2@R`
- **A formula**: one expression, with no assignment, no comparison, no logic and no statement sequence

## Dimensions

- A real exponent scales the SI vector (`@V^2`); a complex exponent needs a dimensionless base (`$e^(-$j*$pi/6)`, `2^(2j)`, `$j^$j`); `0^0` is 1, and zero raised to a negative or complex power is refused. An exponent always has the zero vector.
- Two sides of `+` and `-` must carry the same SI vector, so a dimensionless `5` added to a voltage is refused: write the quantity.
- A dimensionless factor multiplies without changing the vector (`2*@R`, `@theta*@R`), and a pure ratio of two equal vectors is dimensionless.
- `$min`, `$max`, `$mod` and `$atan2` need both arguments on the same vector.
- `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$ln` `$log` `$exp` `$floor` `$ceil` `$sign` take a dimensionless argument. `$asin` `$acos` `$atan` `$arg` return radians, and `$arg` accepts any vector (`$arg(0)` is 0, `$atan2(0,0)` is 0). `$abs` `$re` `$im` `$conj` keep the vector, and `$sqrt` halves it.
- `$ln(-1)`, a division by zero, `$mod` by zero and `$asin(2)` are refused.
- A decibel value and an angle are both dimensionless numbers: `{"num": 3}` is `3`. Turning one into a ratio is a formula you write, and whether the factor is 10 or 20 follows the power or amplitude convention of the case.

## Discipline

The record carries every question; the engine carries only its numbers. A question that needs no calculation still opens and closes a record, with its answer written in `record_message`.

- The gate comes first: store each quantity the user gave, one `set` per quantity, and stop if one is missing.
- Never hard-code a measurement in a formula; reference the slot as `@name`. Constants you derive yourself (unit conversions, 273.15, 10 or 20) are written into the formula.
- A quantity you cannot know and cannot write yourself goes through `search`; everything else still comes from the user. Its answer is not a result, and its sources are the record's business, not yours.
- `set` is transcription into SI: convert the user's unit yourself and let `dim` name the result. A looked-up value keeps the unit its source wrote; `set` it that way and let the engine convert.
- Check every receipt; read values only through `get`.
- Split a long derivation: one intermediate per `eval`, read back with `@name`.
