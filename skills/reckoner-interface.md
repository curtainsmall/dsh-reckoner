---
name: reckoner-interface
description: "Reckoner engine manual: values, the set/get/eval tools, receipts and error codes, the $ notation, dimension rules and the discipline that keeps every number inside the engine"
whenToUse: "Any session that operates the Reckoner engine (set/get/eval, record markers)"
---

# DeepSeek Harness Reckoner — Engine Manual

The engine is a deterministic calculator. It parses values, evaluates the formulas **you** write, derives dimensions, and records every step. It knows no physics, no electronics and no named formulas: the mathematics comes from you, the numerical rules (units, prefixes, complex arithmetic, dimensions) come from the engine. You never parse text into numbers, never convert a prefix or a unit variant, and never do arithmetic yourself.

## Values

A value is ONE string, written the way it is said:

```
4.7kohm        4700ohm       100uohm       12volt       1.5second     50hertz
25degC         14.7psi       2hp           5            (a bare count)
2j             3+4i          1e5                          (complex, scientific notation)
[100ohm, 220ohm]             {v: 12volt, r: 100ohm}       (array, object)
"a string"
```

- **Prefix is one letter, the unit is a whole word**: `p n u m k M G T` (10^-12 through 10^12) + `second metre gram amp kelvin radian decibel hertz ohm farad henry volt watt pascal joule`, plus the variants `degC degF deg bar psi atm cal Wh hp inch foot yard mile lb oz`. A prefix must be followed by a unit - `5k` is refused, `5kohm` is fine.
- **Whole words only**: `ohm` never `Ω`, `second` never `s`, `degC` never `°C`, `metre` never `m` as a unit. Symbols are refused at the character level; everything is ASCII.
- **Scientific notation is lowercase `e`**: `1e5`. Uppercase `E` is refused, and `2e` is refused with the fix.
- **A bare number is a plain count** (`kind: none`). It never inherits a neighbour's unit, which is why `5 + @V_in` is refused: write `5volt`.
- **What is stored is SI**: `4.7kohm` and `4700ohm` are the same stored value; `25degC` becomes 298.15 kelvin. Prefix and variant exist only while parsing and printing.
- **`get`'s `format` uses the same words**: `get { name: "R1", format: "kohm" }` prints a string you can feed straight back into `set` or into a formula.

## Tools

| tool | parameters | receipt |
|---|---|---|
| `set` | `name`, `value` (one value string, or `null` to delete the slot) | `{ ok, name, rev, value }` |
| `get` | `name`, `format` (optional) | `{ ok, name, format, value }` — the printed text |
| `eval` | `formula` (one expression), `target` (slot name, or `null`) | `{ ok, target, rev }` |
| `record_question` | `text` | `{ ok, record }` — clears the table, opens a record |
| `record_analyse` | `text` | `{ ok }` |
| `record_answer` | `text` | `{ ok, record }` — seals the record |

- `set` writes **the conditions the user gave** (transcription). A slot pins its kind on first write; overwriting with a different kind is refused — delete it first (`value: null`).
- `eval` writes **a computed quantity**. `target` is the slot the result is stored in; `target: null` evaluates without storing anything.
- **`eval` does not return its value.** To see a number, call `get` on the slot you wrote it into.
- `get`'s `format`: a unit (`ohm`), a prefix+unit (`kohm`), a variant (`degC`), or `deg` / `rad` / `polar` / `json`. Omit it for the SI form. Printing never changes what is stored.

## Receipts and errors

Every call returns `{ ok: true, … }` or `{ ok: false, code, error }`.

- **A failed call has no side effects**: no slot is written, no value is changed. Read the receipt, fix what `error` names, call again.
- `error` is the one sentence written for you — it names the position, the reason and the fix. Read it and follow it; do not retry the same call unchanged.
- `code` is for machines: `ENGINE_<position>_<reason>`, e.g. `ENGINE_PARSE_UNIT`, `ENGINE_SLOT_UNDECLARED`, `ENGINE_DIM_MISMATCH`, `ENGINE_PARSE_ARITY`.

## Record markers

- `record_question { text }` — open a record; the variable table is cleared. Re-opening seals the previous record as duplicate-start.
- `record_analyse { text }` — the approach: the knowns, the relations you will use, the plan. **No computed numbers here.**
- `record_answer { text }` — the final answer; seals the record.

Conditions are stored with `set` before anything else. Computed numbers exist only after the `eval` that produced them; an answer quotes slot values or `get` results, never a number from your own head.

## Notation

A formula is **one expression**. `@name` READS a slot (it is read-only and never appears on the left of anything); the slot that receives the result is `eval`'s `target` parameter. Bare names are binding variables only, introduced by the bounded notations below.

| family | forms |
|---|---|
| constants (5) | `$pi` `$e` `$inf` `$i` `$j` |
| functions (19) | `$abs` `$sqrt` `$exp` `$ln` `$log` `$sin` `$cos` `$tan` `$asin` `$acos` `$atan` `$floor` `$ceil` `$sign` `$re` `$im` `$arg` `$conj` `$transpose` |
| functions (4) | `$atan2(x, y)` `$min(a, b)` `$max(a, b)` `$mod(a, b)` |
| bounded (3, evaluable) | `$sum_{k=a}^{b}(body)` `$prod_{k=a}^{b}(body)` `$seq_{k=a}^{b}(body)` |
| bounded (3, written but NOT evaluated) | `$integral_{a}^{b}(body, x)` `$diff(body, x)` `$limit_{x->a}(body)` |

- The subscript of a bounded notation gives the bound variable and its lower bound (`_{k=0}`); the superscript gives the upper bound (`^{N-1}`). `$seq` builds an array, which `[i]` then walks.
- `$integral`, `$diff` and `$limit` parse but are refused with `ENGINE_SYMBOL_NOT_EVALUABLE`: state the closed form instead, or say the quantity cannot be computed.
- Operators: `+ - * / ^`. **Multiplication always needs `*`** - `2@R`, `2$pi` and `2(3)` are all refused. `^` is right-associative, and `-2^2` is `-4`.
- Data access: `@x[k]` takes an element (the index is an expression), `@th.field` takes an object field (a literal name). Chain them: `@net.ports[0].z`.
- **No comparison, no logic, no conditional, no assignment** - there is no `if`, no `==`, no `x = ...`, and no statement sequence. `boolean` does not exist; an indicator is `0`/`1` (`kind: none`).

## Dimensions

Every kind maps to a vector of the seven SI base dimensions (kg, m, s, A, K, mol, cd):

| kind | vector | kind | vector |
|---|---|---|---|
| `none` `log` `angle` | dimensionless | `voltage` | (1, 2, -3, -1, 0, 0, 0) |
| `time` | (0, 0, 1, 0, 0, 0, 0) | `resistance` | (1, 2, -3, -2, 0, 0, 0) |
| `length` | (0, 1, 0, 0, 0, 0, 0) | `capacitance` | (-1, -2, 4, 2, 0, 0, 0) |
| `mass` | (1, 0, 0, 0, 0, 0, 0) | `inductance` | (1, 2, -2, -2, 0, 0, 0) |
| `current` | (0, 0, 0, 1, 0, 0, 0) | `power` | (1, 2, -3, 0, 0, 0, 0) |
| `temperature` | (0, 0, 0, 0, 1, 0, 0) | `frequency` | (0, 0, -1, 0, 0, 0, 0) |
| `energy` | (1, 2, -2, 0, 0, 0, 0) | `pressure` | (1, -1, -2, 0, 0, 0, 0) |

The engine carries these vectors through the whole expression, so it checks the mathematics as it computes it - **you do not have to name a kind anywhere**:

- `@V/@R` is a current, `@V*@A` is a power, `@R*@C` is a time, and writing one where the other belongs is refused with the dimensions spelled out.
- An intermediate may have a dimension with **no name** - `(@V)^2/@R` squares a voltage on the way to a power, and that is fine. Only the RESULT must land on a named kind, because the target slot pins one. A result like `(4ohm)^2` is refused: split the formula so each step lands on a named quantity.
- `none` is a plain count: multiplying by it keeps the kind (`2*@R` is a resistance) and adding it to a quantity is refused (`5 + @V_in`).
- Additions and `$min`/`$max`/`$mod` require the same dimension; `$sin`/`$cos`/`$tan` take a plain count or an angle; `$ln`/`$log`/`$exp` take a plain count.
- A result whose kind contradicts the slot it would be written into is refused **before** anything is written.

## Discipline

1. **Numbers come from slots, never from memory.** Every number in an answer is a condition stored by `set` or a value in a slot that an `eval` produced - read it with `get`.
2. **Transcription is yours, numerical rules are the engine's.** Write the values the way the user wrote them (`4.7kohm`, `25degC`); the engine resolves the prefix, the variant and the complex form. Never convert to SI by hand, and never assume an input condition the user did not give.
3. **A formula must use the conditions.** Reference the user's quantities with `@name`; a formula that ignores them and hard-codes a number is wrong even when it evaluates.
4. **Prefer several `eval` calls over one deep expression.** Evaluate an intermediate with its own `target`, then read it back with `@` in the next call. Split when the same sub-expression appears twice, when parentheses nest more than about three deep, or when the line stops being readable. Each call leaves its own formula and result in the record, and the article can then show `Vth`, `Rth` and `Pmax` as named steps instead of one wall of symbols.
5. **`eval` returns no value.** If a later step needs a number, either it is a slot you can reference with `@`, or you have not stored it yet.
6. **Check every receipt.** On failure nothing changed: read `error` and fix that specific thing.
7. **Say so when the conditions are insufficient.** If a quantity the relation needs is missing, do not call `eval` and do not use the markers: name the missing quantity and say which relation therefore cannot be evaluated, then stop.
