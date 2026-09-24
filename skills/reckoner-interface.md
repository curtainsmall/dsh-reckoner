---
name: reckoner-interface
description: The Reckoner engine manual - values, tools, receipts, notation and the dimension rules. Read before writing any formula.
whenToUse: Load before the first Reckoner tool call of a calculation, and again whenever a formula, a receipt or the engine's dimension rules are unclear.
---

# Reckoner engine manual

The engine is a calculator with no domain knowledge: you write the formula, it parses, substitutes, checks the dimensions, evaluates and records. Everything below is engine behaviour, not advice.

## Values

A slot holds one of four value types: `number` (a JSON number), `complex` (stored rectangular as `re`/`im`), `array` (elements sharing one SI vector) and `object` (one vector per field). A quantity is a number plus a 7-integer SI vector; the vector is the whole identity, the name is only how it is written.

`set` takes a tagged object with exactly one tag:

- `{"num": 4.7e3, "dim": "ohm"}` - a real
- `{"re": 3, "im": 4, "dim": "ohm"}` - a complex in rectangular form
- `{"mag": 5, "ang": 0.927295218, "dim": "ohm"}` - a complex in polar form (radians); it is converted to rectangular on the way in
- `{"array": [1, 2, 3], "dim": "volt"}` - an array; its elements are bare numbers, `{re,im}` or nested arrays, and they share the array's `dim`
- `{"object": {"v": {"num": 12, "dim": "volt"}}}` - named fields, each a full value with its own `dim`; an object takes no `dim` of its own

`dim` is a name from the SI table or 7 integers in the order `m,kg,s,A,K,mol,cd`; omitted it is the zero vector. `value: null` deletes the slot, idempotently. Only whole SI vectors can be stored: a fractional vector (from `$sqrt` or a fractional power) is refused when it lands in a slot.

## Tools

- `set {name, value}` - write one slot. The receipt echoes what was stored: `dim` always as 7 integers, a complex always as `re`/`im`, an array with one `dim`, an object field by field.
- `get {name, form?, digits?, dim?}` - read one slot.
  - `form`: `"rect"` for `{re,im}`, `"polar"` for `{mag,ang}` in radians. A real is widened to a complex (`rect`: `{re:x, im:0}`; `polar`: `{mag:|x|, ang:0}`, and `pi` for a negative real). Omitted keeps the stored form.
  - `digits`: round to at most that many significant digits (4700 has 4), never padding.
  - `dim`: convert into that spelling, or - given 7 integers - check the vector without converting. A mismatch is refused.
  - The `value` of a `get` receipt can be fed straight back into `set`.
- `eval {formula, target}` - evaluate ONE expression and write the result into `target` (a required slot name). The receipt is `{ok, target, rev}`; `eval` does not return the value, so read it with `get`.
- `search {question}` - look one fact up outside the calculation. It exists only in the `reckoner-with-search` preset; in the pure preset it is not part of the surface, so never call it there. Ask for the fact the way you would ask a colleague ("thermal conductivity of copper at 300 K"). The receipt is `{ok, answer, origin}` or `{ok: false, code, error}`: you get the answer as words, never the pages, the queries or the sources - those go into the record, with the route and the prompt version that produced them. Four rules:
  - The answer is an INPUT, not a result: transcribe it with `set`, copying the number with the unit exactly as written, and let the engine convert.
  - Never ask it to compute, convert, round or derive anything, and never ask for something the record already holds.
  - `SEARCH_INSUFFICIENT` means no allowed source holds the fact: that quantity is missing, so say which relation cannot be evaluated and stop.
  - `SEARCH_BUDGET_EXCEEDED` means the record has spent its lookups: continue with what the record holds, or state what is missing. `SEARCH_UNAVAILABLE` is a technical failure and changes nothing.

## Receipts and errors

Every call answers `{ok: true, ...}` or `{ok: false, code, error}`. A failure writes nothing: no slot changes, and the trace records the failure row. `error` is written for you - it carries the concrete value, the boundary or the expectation, and the fix. `code` is a stable identifier, useful in logs and tests.

The codes: `ENGINE_INVALID_FORMULA`, `ENGINE_INVALID_NUMBER`, `ENGINE_INVALID_IDENTIFIER`, `ENGINE_INVALID_DIMENSION`, `ENGINE_INVALID_NOTATION`, `ENGINE_INVALID_ARITY`, `ENGINE_SLOT_NOT_FOUND`, `ENGINE_NAME_NOT_BOUND`, `ENGINE_INCOMPATIBLE_DIMENSION`, `ENGINE_UNSUPPORTED_OPERATION`, `ENGINE_INVALID_INDEX`, `ENGINE_UNDEFINED_RESULT`, `ENGINE_UNSUPPORTED_INDEX`, `ENGINE_FIELD_NOT_FOUND`, `ENGINE_UNSUPPORTED_SYMBOL`, `ENGINE_INVALID_ARGS`, `ENGINE_OPEN_RECORD_NOT_FOUND`, `ENGINE_OPEN_RECORD_FOUND`, `ENGINE_UNKNOWN_ERROR`.

## Record markers

`record_start {title}` opens a record; it fails while a record is open (`ENGINE_OPEN_RECORD_FOUND`). `record_message {text, hide?}` writes one explanation - as many as the work needs, in any order relative to `eval`; `hide: true` keeps it out of the record view but still gives it to the article writer. `record_end {text?}` closes the record and writes it to disk; it fails when no record is open (`ENGINE_OPEN_RECORD_NOT_FOUND`). `set`, `get` and `eval` are refused while no record is open. Closing clears the slot table, so a new record starts empty. Each marker answers `{ok}`.

## Notation

Constants: `$pi` `$e` `$inf` `$i` `$j`.

Unary functions: `$abs` `$sqrt` `$exp` `$ln` `$log` `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$floor` `$ceil` `$sign` `$re` `$im` `$arg` `$conj` `$transpose` `$len`.

Two-argument functions: `$atan2` `$min` `$max` `$mod`.

Bounded forms: `$sum_{k=a}^{b}(body)`, `$prod_{k=a}^{b}(body)`, `$seq_{k=a}^{b}(body)`. Both bounds are required, they are integers with the zero vector, they are inclusive, and they are evaluated once before the body. `$seq` builds an array; nested `$seq` builds a row-major two-dimensional array. `$transpose(M)` takes a two-dimensional array and leaves the vector unchanged; `$len(array)` counts elements and is itself a usable bound.

Writable but not evaluable: `$integral_{a}^{b}(body, x)` or `$integral(body, x)`, `$limit_{x->a}(body)`, `$diff(body, x)` or `$diff(body, x, n)`. Evaluating one is refused.

A position is the brace directly after the notation name: `_{k=a}`, `^{N}`. Every other `^` is a power, so `$e^(2)` and `$pi^2` are powers while `$pi^{2}` is not accepted. A bound expression holds no loop variable: `^{N-1}` is an unbound name, write `^{@N-1}`.

Slots are read as `@name`, an array element as `@name[index]` (the index is an expression, an integer with the zero vector), an object field as `@name.field`, and these chain: `@net.ports[0].z`. A bare name is a bound variable only.

Operators: `+ - * / ^` with brackets. Precedence: additive, multiplicative, unary, power, postfix, primary; `^` is right-associative and `-2^2` is `-4`. Multiplication must be written: `2*@R`, never `2@R`. A formula is one expression - no assignment, no comparison, no logic, no statement sequence.

## Dimensions

A real exponent scales the SI vector (`@V^2`); a complex exponent needs a dimensionless base (`$e^(-$j*$pi/6)`, `2^(2j)`, `$j^$j`). `0^0` is 1; zero raised to a negative or complex power is refused. An exponent always has the zero vector.

Two sides of `+` and `-` must carry the same SI vector, so a dimensionless `5` added to a voltage is refused - write the quantity. A dimensionless factor multiplies without changing the vector (`2*@R`, `@theta*@R`); a pure ratio of two equal vectors is dimensionless.

`$min`, `$max`, `$mod` and `$atan2` need both arguments on the same vector. `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$ln` `$log` `$exp` `$floor` `$ceil` `$sign` take a dimensionless argument; `$asin` `$acos` `$atan` `$arg` return radians, and `$arg` accepts any vector (`$arg(0)` is 0, `$atan2(0,0)` is 0). `$abs` `$re` `$im` `$conj` keep the vector, `$sqrt` halves it. `$ln(-1)`, a division by zero, `$mod` by zero and `$asin(2)` are refused.

A decibel value and an angle are both dimensionless numbers: `{"num": 3}` is `3`. Turning one into a ratio is a formula you write - whether the factor is 10 or 20 follows the power or amplitude convention of the case.

## Discipline

- The record carries every question; the engine carries only its numbers. A question that needs no calculation still opens and closes a record, with its answer written in `record_message`.
- The gate comes first: store each quantity the user gave, one `set` per quantity, and stop if one is missing.
- Never hard-code a measurement in a formula; reference the slot as `@name`. Constants you derive yourself (unit conversions, 273.15, 10 or 20) are written into the formula.
- A quantity you cannot know and cannot write yourself goes through `search`; everything else still comes from the user. Its answer is not a result, and its sources are the record's business, not yours.
- `set` is transcription into SI: convert the user's unit yourself and let `dim` name the result. A looked-up value keeps the unit its source wrote; `set` it that way and let the engine convert.
- Check every receipt; read values only through `get`.
- Split a long derivation: one intermediate per `eval`, read back with `@name`.
