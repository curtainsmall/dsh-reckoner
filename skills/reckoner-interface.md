---
name: reckoner-interface
description: The Reckoner engine manual - values, tools, receipts, notation and the dimension rules. Read before writing any formula.
whenToUse: Load before the first Reckoner tool call of a calculation, and again whenever a formula, a receipt or the engine's dimension rules are unclear.
---

# Reckoner engine manual

The engine is a calculator with no domain knowledge: you write the formula, it parses, substitutes, checks the dimensions, evaluates and records. Everything below is engine behaviour, not advice.

## Values

| type | shape | note |
|---|---|---|
| `number` | a JSON number | |
| `complex` | `re` / `im` | stored rectangular |
| `array` | elements | one vector for the whole array |
| `object` | named fields | one vector per field |

A quantity is a number plus a 7-integer SI vector. The vector is the whole identity; the name is only how it is written.

`set` takes a tagged object with exactly one tag:

| tag | example | note |
|---|---|---|
| `num` | `{"num": 4.7e3, "dim": "ohm"}` | a real |
| `re` / `im` | `{"re": 3, "im": 4, "dim": "ohm"}` | rectangular |
| `mag` / `ang` | `{"mag": 5, "ang": 0.927295218, "dim": "ohm"}` | radians; converted on the way in |
| `array` | `{"array": [1, 2, 3], "dim": "volt"}` | elements share the array's `dim` |
| `object` | `{"object": {"v": {"num": 12, "dim": "volt"}}}` | one `dim` per field; the object has none |

| `dim` | meaning |
|---|---|
| a table name | the vector, with the name's affine map |
| 7 integers, `m,kg,s,A,K,mol,cd` | the vector, with no affine map |
| omitted | the zero vector |

| rule | effect |
|---|---|
| `value: null` | deletes the slot, idempotently |
| a storable vector | whole exponents only |
| a fractional vector | refused at the slot |

Array elements are bare numbers, `{re,im}` or nested arrays. A fractional vector comes from `$sqrt` or a fractional power.

## Tools

### `set {name, value}`

Writes one slot. The receipt echoes what was stored: `dim` as 7 integers, a complex as `re`/`im`, an array with one `dim`, an object field by field.

### `get {name, form?, digits?, dim?}`

Reads one slot. Its `value` can be fed straight back into `set`.

| parameter | value | effect |
|---|---|---|
| `form` | `"rect"` | `{re,im}` |
| | `"polar"` | `{mag,ang}`, radians |
| | omitted | the stored form |
| `digits` | an integer | at most that many significant digits (4700 has 4), never padding |
| `dim` | a name | convert into that spelling |
| | 7 integers | check the vector, no conversion |

A real is widened to a complex on request: `rect` gives `{re:x, im:0}`, `polar` gives `{mag:|x|, ang:0}` and `pi` for a negative real. A `dim` that is 7 integers refuses a mismatch.

### `eval {formula, target}`

Evaluates ONE expression and writes the result into `target`, a required slot name.

| item | value |
|---|---|
| receipt | `{ok, target, rev}` |
| the value | not returned; read it with `get` |

### `search {question}`

Looks one fact up outside the calculation. It exists only in the `reckoner-with-search` preset; in the pure preset it is not part of the surface, so never call it there. Ask for the fact the way you would ask a colleague ("thermal conductivity of copper at 300 K").

| item | value |
|---|---|
| receipt | `{ok, answer, origin}` or `{ok: false, code, error}` |
| received | the answer as words |
| never received | the pages, the queries, the sources |
| destination of those | the record, with the route and prompt version |

| rule | detail |
|---|---|
| the answer is an INPUT | transcribe it with `set`, copying the number with its unit as written |
| never ask it to | compute, convert, round or derive |
| never ask for | something the record already holds |
| `SEARCH_INSUFFICIENT` | no allowed source holds the fact |
| `SEARCH_BUDGET_EXCEEDED` | the record has spent its lookups |
| `SEARCH_UNAVAILABLE` | a technical failure; it changes nothing |

`SEARCH_INSUFFICIENT` means that quantity is missing: say which relation cannot be evaluated and stop. `SEARCH_BUDGET_EXCEEDED` means continue with what the record holds, or state what is missing.

## Receipts and errors

| field | meaning |
|---|---|
| `ok` | `true`, or `false` with a `code` and an `error` |
| `error` | the concrete value, the boundary or the expectation, and the fix |
| `code` | a stable identifier, useful in logs and tests |

On failure nothing changes: no slot is written, and the failure row is recorded.

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

| rule | effect |
|---|---|
| `hide: true` | out of the record view, still given to the writer |
| `set`, `get`, `eval` | refused while no record is open |
| closing | clears the slot table, so a new record starts empty |
| each marker | answers `{ok}` |

A failure carries `ENGINE_OPEN_RECORD_FOUND` or `ENGINE_OPEN_RECORD_NOT_FOUND` as the table above says.

## Notation

| constants |
|---|
| `$pi` `$e` `$inf` `$i` `$j` |

| unary functions | | | | |
|---|---|---|---|---|
| `$abs` | `$sqrt` | `$exp` | `$ln` | `$log` |
| `$sin` | `$cos` | `$tan` | `$asin` | `$acos` |
| `$atan` | `$floor` | `$ceil` | `$sign` | `$re` |
| `$im` | `$arg` | `$conj` | `$transpose` | `$len` |

| two-argument functions | | | |
|---|---|---|---|
| `$atan2` | `$min` | `$max` | `$mod` |

| bounded form | writes | evaluable |
|---|---|---|
| `$sum_{k=a}^{b}(body)` | a sum over `k` | yes |
| `$prod_{k=a}^{b}(body)` | a product over `k` | yes |
| `$seq_{k=a}^{b}(body)` | an array | yes |
| `$integral_{a}^{b}(body, x)` | an integral | no |
| `$limit_{x->a}(body)` | a limit | no |
| `$diff(body, x)` | a derivative | no |

| bounded-form rule | detail |
|---|---|
| bounds | both required, integers with the zero vector, inclusive |
| evaluation order | once, before the body |
| `$integral` | also writable as `$integral(body, x)` |
| `$diff` | also writable as `$diff(body, x, n)` |
| `$transpose(M)` | a two-dimensional array; the vector is unchanged |
| `$len(array)` | counts elements, and is a usable bound |
| nested `$seq` | a row-major two-dimensional array |

| position | meaning |
|---|---|
| `_{k=a}`, `^{N}` | the brace directly after the notation name |
| every other `^` | a power: `$e^(2)` and `$pi^2` are powers, `$pi^{2}` is refused |
| a bound expression | no loop variable: `^{N-1}` is unbound, write `^{@N-1}` |

| access | reads |
|---|---|
| `@name` | a slot |
| `@name[index]` | an element; the index is an integer with the zero vector |
| `@name.field` | a field |
| chaining | `@net.ports[0].z` |
| a bare name | a bound variable only |

| operator rule | detail |
|---|---|
| operators | `+ - * / ^` with brackets |
| precedence | additive, multiplicative, unary, power, postfix, primary |
| associativity | `^` right-associative, and `-2^2` is `-4` |
| multiplication | written `2*@R`, never `2@R` |
| a formula | one expression |

A formula has no assignment, no comparison, no logic and no statement sequence.

## Dimensions

| exponent | rule |
|---|---|
| a real exponent | scales the vector: `@V^2` |
| a complex exponent | needs a dimensionless base |
| `0^0` | is 1 |
| zero to a negative or complex power | refused |
| any exponent | has the zero vector |

| context | rule |
|---|---|
| `+` and `-` | both sides carry the same vector |
| a dimensionless factor | multiplies without changing the vector |
| a ratio of two equal vectors | dimensionless |
| `$min`, `$max`, `$mod`, `$atan2` | both arguments on the same vector |

A plain count is not a quantity: a dimensionless `5` added to a voltage is refused, so write the quantity. Complex examples: `$e^(-$j*$pi/6)`, `2^(2j)`, `$j^$j`.

| function class | functions |
|---|---|
| dimensionless argument | `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$ln` `$log` `$exp` `$floor` `$ceil` `$sign` |
| returns radians | `$asin` `$acos` `$atan` `$arg` |
| any vector accepted | `$arg` |
| vector kept | `$abs` `$re` `$im` `$conj` |
| vector halved | `$sqrt` |
| refused | `$ln(-1)`, a division by zero, `$mod` by zero, `$asin(2)` |

`$arg(0)` is 0, and `$atan2(0,0)` is 0.

| case | rule |
|---|---|
| a decibel value | a dimensionless number: `{"num": 3}` is `3` |
| an angle | a dimensionless number |
| a ratio from one | a formula you write: the factor is 10 or 20 by convention |

## Discipline

The record carries every question; the engine carries only its numbers. A question that needs no calculation still opens and closes a record, with its answer written in `record_message`.

| rule | detail |
|---|---|
| the gate | one `set` per quantity the user gave; stop if one is missing |
| measurements | never hard-coded; reference the slot as `@name` |
| constants you derive | unit conversions, 273.15, 10 or 20: written into the formula |
| what you cannot know | goes through `search`; the rest comes from the user |
| a looked-up answer | not a result; its sources are the record's business |
| `set` | transcription into SI: convert the unit, let `dim` name the result |
| a looked-up value | keeps the unit its source wrote; the engine converts it |
| receipts | check every one; read values only through `get` |
| a long derivation | one intermediate per `eval`, read back with `@name` |
