# Reckoner Engine Manual

[简体中文](engine.zh-CN.md)

Every calculation in the Reckoner plugin happens inside one deterministic **engine**. It is a calculator with no domain knowledge: no built-in solver, no registry, no solver signature, no physics and no named formula. The model supplies the mathematics as a formula, and the engine applies every numerical rule — it parses values, resolves prefixes and unit variants, does complex arithmetic, derives dimensions while it evaluates, and records every step into a record that can be read back.

One engine runs per host process. Any session's markers act on it, and at most one record is open at a time.

Sessions started in **Reckoner Mode** carry the same rules in the `reckoner-interface` and `reckoner-template` skills.

## Contents

- [1. What the engine is](#1-what-the-engine-is)
- [2. The plugin surface](#2-the-plugin-surface)
- [3. Values](#3-values)
- [4. Formulas](#4-formulas)
- [5. Notation](#5-notation)
- [6. Dimensions](#6-dimensions)
- [7. Records and the trace](#7-records-and-the-trace)
- [8. Errors](#8-errors)
- [9. Storage and logs](#9-storage-and-logs)
- [10. Article generation](#10-article-generation)
- [11. The panel](#11-the-panel)

## 1. What the engine is

The engine is deterministic, and the split of work is exact:

| the engine does | the model does |
|---|---|
| parse one value string into SI and keep its kind | write the value the way it is said: `4.7kohm`, `25degC` |
| resolve a prefix, a unit variant and a complex form | choose the relations and write the formula |
| evaluate one expression | reference the user's quantities with `@name` |
| derive the dimension of every intermediate and of the result | — |
| refuse a result that does not measure what the target slot pins | fix the formula and call `eval` again |
| append one trace row per step, input and output both | read the numbers back with `get` |

- **There is no registry and no solver signature.** The engine holds no domain knowledge at all; it knows no physics, no electronics and no named formula. The mathematics comes from the model as a formula, the numerical rules come from the engine.
- **Arithmetic happens only inside `eval`.** `set` transcribes what it was given; nothing is computed at that boundary.
- **Numbers come from slots, never from memory.** Every number in an answer is a condition stored by `set`, or a value a previous `eval` wrote into its target, and it is read back with `get`.
- **A formula must use the conditions.** A formula that ignores the user's quantities and hard-codes a number is wrong even when it evaluates.

## 2. The plugin surface

| tool | parameters | receipt |
|---|---|---|
| `set` | `name`, `value` (one value string, or `null` to delete the slot) | `{ ok:true, name, rev, value }`; delete: `{ ok:true, name, deleted }` |
| `get` | `name`, `format` (optional) | `{ ok:true, name, format, value }` — `value` is the printed text |
| `eval` | `formula` (one expression), `target` (a slot name, or `null`) | `{ ok:true, target, rev }` |
| `record_question` | `text` | `{ ok:true, record }` — opens a record and clears the variable table |
| `record_analyse` | `text` | `{ ok:true }` |
| `record_answer` | `text` | `{ ok:true, record }` — seals the record |

Every call returns one receipt, and there is no second failure channel:

```
success: set  → { ok:true, name, rev, value }    delete: { ok:true, name, deleted }
         get  → { ok:true, name, format, value }
         eval → { ok:true, target, rev }         target null: { ok:true, target:null, rev:null }
failure:      → { ok:false, code, error }
```

- `set` writes **the conditions the user gave** (transcription). Its receipt echoes the stored value printed in its SI form: `value: "4.7kohm"` comes back as `value: "4700ohm"`.
- `eval` writes **a computed quantity**. `target` is the slot the result is stored in; `target: null` evaluates without storing anything.
- **`eval` does not return its value.** To see a number, call `get` on the slot you wrote it into.
- `get`'s `format` decides how the stored value is printed (§3.4); omit it for the SI form.
- **A failed call has no side effects**: no slot is written, no value changes. Read the receipt, fix what `error` names, call again (§8).

### 2.1 Slot rules

| rule | behaviour |
|---|---|
| name | letters, digits and underscore, starting with a letter or underscore; `name` and `target` are bare slot names, never `@name` |
| pin | the first write pins the slot's kind; a later write of a different kind or type fails with `ENGINE_SLOT_KIND` and does not advance the revision |
| overwrite | a same-kind overwrite replaces the value and bumps `rev`; nothing is inherited |
| delete | `set` with `value: null` removes the slot; deleting a missing slot is an idempotent ok with `deleted: false`, and re-creating it starts at rev 1 |
| failure | a failed operation writes nothing |

## 3. Values

A value is **ONE plain string**, written the way it is said:

```
4.7kohm        4700ohm       100uohm       12volt        1.5second     50hertz
25degC         14.7psi       2hp           5             (a bare count)
2j             3+4i          1e5                          (complex, scientific notation)
[100ohm, 220ohm]             {v: 12volt, r: 100ohm}       (array, object)
"a string"
```

There is no typed-value envelope and no slot-reference value: a value is a string, `@name` is syntax inside a formula (§4), and there is no `boolean` type — an indicator is `0`/`1` with kind `none`.

### 3.1 Prefixes, units and variants

**A prefix is one letter, a unit is a whole word.** The prefixes are `p n u m k M G T` (10^-12 through 10^12) and a prefix must be followed by a unit: `5k` is refused, `5kohm` is fine. A prefix also combines with a variant word: `10kdegC` is `k` + `degC`.

The unit words are `second metre gram amp kelvin radian decibel hertz ohm farad henry volt watt pascal joule`, plus the variants — each one expressing a kind in a non-SI way:

| variant | kind | SI base it converts to |
|---|---|---|
| `degC`, `degF` | temperature | K |
| `deg` | angle | rad |
| `bar`, `psi`, `atm` | pressure | Pa |
| `cal`, `Wh` | energy | J |
| `hp` | power | W |
| `inch`, `foot`, `yard`, `mile` | length | m |
| `lb`, `oz` | mass | kg |

- **Whole words only**: `ohm` never `Ω`, `second` never `s`, `degC` never `°C`. Symbols are refused at the character level; everything is ASCII.
- **A bare number is a plain count** (kind `none`). It never inherits a neighbour's unit, which is why `5 + @V_in` is refused — write `5volt`.
- **What is stored is SI**: `4.7kohm` and `4700ohm` are the same stored value (`4700` + `resistance`); `25degC` becomes `298.15` + `temperature`. The prefix and the variant word exist only while parsing and printing.

### 3.2 Complex and scientific notation

`2j`, `3+4i`, `3-4j`: `i` and `j` are the imaginary suffix, so a term carrying one is imaginary, and a bare `i` or `j` is the imaginary unit itself. A complex is stored rectangular (`re`, `im`). Scientific notation takes a lowercase `e` only: `1e5`; `1E5` and `2e` are refused, each with the rewrite in `error`.

### 3.3 Structures

`[100ohm, 220ohm]` is an array, `{v: 12volt, r: 100ohm}` is an object with literal field names, and `"a string"` is a string (escapes `\"`, `\\`, `\n`, `\t`). A value is one value and never an arithmetic expression: `2*3` is refused, and the message says that a value is one quantity, complex number, array, object or string.

### 3.4 Printing: `get`'s `format`

`get` prints a stored value; printing never changes what is stored. The format vocabulary is the vocabulary of §3.1, so what `get` prints can usually be fed straight back into `set` or a formula.

| format | prints |
|---|---|
| omitted | the SI form: `4700ohm` |
| a unit (`ohm`) | the same word: `4700ohm` |
| a prefix + unit (`kohm`) | `4.7kohm` |
| a variant (`degC`) | `25degC` — the affine conversion happens here |
| `deg` / `rad` | an angle |
| `polar` | a complex in polar form: `111.80339887498948∠0.4636476090008061` (the default is rectangular: `100+50j`) |
| `json` | the stored envelope: `{"type":"number","value":4700,"kind":"resistance"}` |

- A word that names no unit, no prefix+unit and no variant, and is none of the special words (`rad`, `polar`, `json`), is refused, and the message lists the legal ones.
- A kind with no unit word (`none`) prints as a bare number.
- An array prints element-wise and an object field-wise, each with the same format.
- One exception to round-tripping: a complex is always printed unitless, so `3+4j` is what the parser reads back.

### 3.5 Slot references

A slot reference is `@name`, and it exists **only inside a formula** (§4). It is read-only; the slot that receives a result is `eval`'s `target` parameter. Nothing stores a reference, and no reference ever appears in a value or in a printed result.

## 4. Formulas

`eval` takes **one expression** and a `target`:

```
formula        := expression
expression     := additive
additive       := multiplicative (('+' | '-') multiplicative)*
multiplicative := unary (('*' | '/') unary)*
unary          := ('-' | '+')* power
power          := postfix ('^' unary)?              # right-associative
postfix        := primary ('[' expression ']' | '.' IDENT)*
primary        := NUMBER | IDENT | '$' symbol | '@' IDENT
                | '(' expression ')' | arrayLiteral | objectLiteral | STRING
symbol         := '$' IDENT
                | '$' IDENT '(' args ')'
                | '$' IDENT '_{' subexpr '}' ['^{' subexpr '}'] '(' args ')'
```

### 4.1 Reading and writing

- `@name` **READS** a slot. It is read-only and never appears on the left of anything.
- `target` is the slot the call **WRITES**, and it is a parameter, not syntax.
- **There is no assignment inside a formula**: neither `@x = …` (slots are read-only) nor `x = …` (there is no local variable), and no statement sequence. `=` exists only inside a subscript position (`_{k=a}`), where it binds.
- A bare name is a **binding variable** introduced by a bounded notation (`$sum_{k=a}^{b}(…)`, `$prod_{k=a}^{b}(…)`, `$seq_{k=a}^{b}(…)`, `$diff(body, x)`, `$integral_{a}^{b}(body, x)`, `$limit_{x->a}(…)`). Any other bare name is refused with `ENGINE_IDENT_UNBOUND`, whose message tells you to write `@name`.
- String literals (`"…"`) are values; the language has no operation on them beyond carrying them.

### 4.2 Operators and precedence

- The operators are `+ - * / ^`; `->` appears only inside a `$limit` subscript (`x->a`).
- Precedence runs additive → multiplicative → unary → power → postfix → primary. `^` is right-associative and binds tighter than unary minus, so `-2^2` is `-4`.
- **Multiplication always needs `*`**: `2@R`, `2$pi` and `2(3)` are all refused.
- A unit written after a space belongs to the number: `100 ohm` is `100ohm`.

### 4.3 Data access

| form | meaning |
|---|---|
| `@x[k]` | element `k` of an array; the index is an expression and must be a whole number with no unit |
| `@th.field` | the object field `field`; a literal name, not an expression |
| chaining | `@net.ports[0].z` — indexes and fields chain in one path |

An index outside the array is refused with the index and the length, a non-array is refused as not indexable, and a field that does not exist is refused together with the fields the object does have.

### 4.4 Arrays are element-wise

- Both sides of an operator must have the same length (`ENGINE_ARGS_INVALID` names both lengths), elements are combined one by one, and a scalar broadcasts over the other side.
- A formula's array literal must hold one kind; a mixed literal fails with `ENGINE_TYPE_MIXED_KIND`, naming the element that broke it and the first element.
- There is no matrix algebra: `$seq` builds the arrays, `[...]` walks them, and `$transpose` transposes a matrix written as arrays of arrays (§5).

### 4.5 `target` and the size of a step

- `target` is a bare slot name. An existing slot must match the kind it pins; a new slot is pinned to the kind the formula derived. A result whose kind contradicts the slot is refused before anything is written (§6).
- `target: null` evaluates without storing anything; the result still lands in the record.
- **Prefer several `eval` calls over one deep expression.** Split the work when the same sub-expression appears twice, when parentheses nest more than about three deep, or when the line stops being readable: evaluate the intermediate with its own `target`, then read it back with `@` in the next call. Each call leaves its own formula and result in the record, so the article can show `Vth`, `Rth` and `Pmax` as named steps instead of one wall of symbols.

### 4.6 What the language does not have

**No comparison, no logic, no conditional and no assignment**: there is no `if`, no `==`, no `&&`, no `x = …`, and no statement sequence. `boolean` does not exist either — an indicator function is a `0`/`1` with kind `none`.

## 5. Notation

Every notation starts with `$`, which is the engine's namespace: a user name (`sum`, `abs`, `ohm`) never collides with a notation, and no name is reserved. A `$` name outside the table below is a parse error, not a function discovered at run time, and its message lists the whole vocabulary.

A notation may carry a **subscript** `_{...}` and a **superscript** `^{...}`, written as brace-delimited positions. Each notation defines what its own positions hold, so they may differ: for the bounded forms the subscript gives the bound variable and its lower bound (`_{k=0}`) and the superscript gives the upper bound (`^{@N-1}` — the bound is an expression, so a slot is written `@N`). A constant takes no position at all, and because a position is the brace that follows the marker, every other `^` is the power operator: `$e^(2)` and `$pi^2` are fine. A position holds either the notation's own binding form (`k=a`, `x->a`) or an expression; a bare name in one is a binding variable, so `^{N-1}` is refused with the reminder to write `@N`.

### 5.1 Constants (5)

| notation | meaning |
|---|---|
| `$pi` | the ratio of a circle to its diameter |
| `$e` | the base of the natural logarithm |
| `$inf` | infinity |
| `$i` | the imaginary unit |
| `$j` | the imaginary unit (engineering spelling) |

### 5.2 Functions (19 unary)

| notation | meaning |
|---|---|
| `$abs` | absolute value |
| `$sqrt` | square root |
| `$exp` | e raised to the argument |
| `$ln` | natural logarithm |
| `$log` | logarithm base 10 |
| `$sin` | sine of a dimensionless value or an angle |
| `$cos` | cosine of a dimensionless value or an angle |
| `$tan` | tangent of a dimensionless value or an angle |
| `$asin` | inverse sine, result in radians |
| `$acos` | inverse cosine, result in radians |
| `$atan` | inverse tangent, result in radians |
| `$floor` | largest integer not greater than the argument |
| `$ceil` | smallest integer not less than the argument |
| `$sign` | sign of the argument: -1, 0 or 1 |
| `$re` | real part |
| `$im` | imaginary part |
| `$arg` | argument (phase) in radians |
| `$conj` | complex conjugate |
| `$transpose` | transpose of a matrix given as arrays of arrays |

### 5.3 Functions (4 binary)

| notation | meaning |
|---|---|
| `$atan2(x, y)` | angle of the point (x, y), in radians |
| `$min(a, b)` | smaller of two values of the same kind |
| `$max(a, b)` | larger of two values of the same kind |
| `$mod(a, b)` | remainder of a divided by b |

### 5.4 Bounded forms (6)

| notation | meaning | evaluable |
|---|---|---|
| `$sum_{k=a}^{b}(body)` | Σ: sum the body as the subscript variable runs from the lower to the upper bound | yes |
| `$prod_{k=a}^{b}(body)` | Π: multiply the body over the same range | yes |
| `$seq_{k=a}^{b}(body)` | build an array from the body over the same range | yes |
| `$integral_{a}^{b}(body, x)` | ∫: parsed, not evaluated by this engine | no |
| `$diff(body, x)` | d/dx: parsed, not evaluated by this engine | no |
| `$limit_{x->a}(body)` | lim: parsed, not evaluated by this engine | no |

- The subscript must give a binding variable and its lower bound, and the superscript the upper bound; both bounds must be whole numbers with no unit. An upper bound below the lower one is refused: `the upper bound 1 is below the lower bound 5 — nothing to sum`.
- `$seq` is the only notation that builds an array, and `[i]` then walks it; a nested `$seq` produces the rows of a 2-D array. `$sum` and `$prod` are the same body summed and multiplied instead of collected.
- **`$integral`, `$diff` and `$limit` parse but are not evaluable.** Evaluating one fails with `ENGINE_SYMBOL_NOT_EVALUABLE`, whose message names the written form and tells you to state the closed form instead, or to say the value cannot be computed. They exist so a formula can still *say* what it means.
- Argument counts are checked: `ENGINE_PARSE_ARITY` names the notation, the count it takes and the count it got.
- What the functions need from their arguments is a dimension rule as much as a type rule — `$sin` takes a plain count or an angle, `$ln` takes a positive plain count, `$sqrt` halves the dimension, `$min`/`$max`/`$mod` need both sides to measure the same thing (§6).

## 6. Dimensions

Every kind maps to a vector of the seven SI base dimensions `(kg, m, s, A, K, mol, cd)`. The engine carries the vector through the whole expression, so it checks the mathematics as it computes it — you never have to name a kind anywhere.

| kind | vector | kind | vector |
|---|---|---|---|
| `time` | (0, 0, 1, 0, 0, 0, 0) | `voltage` | (1, 2, -3, -1, 0, 0, 0) |
| `length` | (0, 1, 0, 0, 0, 0, 0) | `resistance` | (1, 2, -3, -2, 0, 0, 0) |
| `mass` | (1, 0, 0, 0, 0, 0, 0) | `capacitance` | (-1, -2, 4, 2, 0, 0, 0) |
| `current` | (0, 0, 0, 1, 0, 0, 0) | `inductance` | (1, 2, -2, -2, 0, 0, 0) |
| `temperature` | (0, 0, 0, 0, 1, 0, 0) | `power` | (1, 2, -3, 0, 0, 0, 0) |
| `amount-of-substance` | (0, 0, 0, 0, 0, 1, 0) | `frequency` | (0, 0, -1, 0, 0, 0, 0) |
| `luminous-intensity` | (0, 0, 0, 0, 0, 0, 1) | `pressure` | (1, -1, -2, 0, 0, 0, 0) |
| `angle` | dimensionless | `energy` | (1, 2, -2, 0, 0, 0, 0) |
| `log` | dimensionless | `none` | dimensionless |

### 6.1 The rules

- Addition and subtraction, and `$min`/`$max`/`$mod`, require the same dimension; the refusal spells both dimensions out. `none + voltage` is refused because the bare count does not say whether the 5 is volts: write `5volt`, or multiply if that is what you mean.
- Multiplication adds the vectors, division subtracts them and `^` scales them by the exponent. An exponent must be dimensionless. A real exponent scales the base's vector (`(4volt)^2` measures `volt^2`); a complex exponent is allowed only on a dimensionless base, because its phase is `Im(exponent)×ln|base|` and `ln|base|` would otherwise shift with the unit the base is written in. So `$e^(-$j*$pi/6)` is a rotation, `2^(2j)` is one too, and `(4ohm)^(1+1j)` is refused. `0` to a negative or complex power has no value.
- `none` is a plain count: multiplying by it keeps the other side's kind (`2*@R` is a resistance), and `none × voltage = voltage`.
- `angle` and `log` are dimensionless, but each is its own kind: an angle can be added to an angle and to nothing else, and a logarithm is a plain ratio.
- `$sin`/`$cos`/`$tan` take a plain count or an angle and return a plain count; `$asin`/`$acos`/`$atan` take a plain count between -1 and 1 and return an angle in radians; `$ln`/`$log`/`$exp`/`$floor`/`$ceil`/`$sign` take a plain count.
- `$abs`, `$re`, `$im` and `$conj` keep the dimension of their argument, `$arg` returns an angle in radians, and `$sqrt` halves the vector (so `$sqrt((4ohm)^2)` is a resistance).

### 6.2 Unnamed intermediates and the result

`volt^2` is a real dimension with no name, and it is perfectly legal **inside** a formula: `(@V)^2/@R` squares a voltage on the way to a power.

**Only the RESULT must land on a named kind**, because the target slot pins one. A result like `(4ohm)^2` is refused with `ENGINE_DIM_MISMATCH`; the message says the result measures an unnamed dimension, and tells you to split the formula so each step lands on a named quantity.

### 6.3 The refusal

A result whose kind contradicts the slot it would be written into is refused **before anything is written**: the receipt is `{ ok:false, code:"ENGINE_DIM_MISMATCH", error:"…" }`, the message names the expected kind and the derived one with both vectors, and the slot is untouched.

Where a slot's kind comes from:

| write | the kind it pins |
|---|---|
| `set` with a unit | the kind that unit expresses (`4.7kohm` → `resistance`, `25degC` → `temperature`) |
| `set` with a bare number | `none` |
| `eval` into a new target | the kind the formula derived |
| `eval` into an existing target | must match the kind already pinned, or the call is refused |

## 7. Records and the trace

A solve is bracketed by the markers:

| marker | effect |
|---|---|
| `record_question` | opens a record and clears the variable table |
| `record_analyse` | submits the approach: the knowns, the relations and the plan, with no computed numbers |
| `record_answer` | submits the final answer and seals the record |

- `record_question` appends its question row and clears the table; a second `record_question` first seals the record that was open with a `seal` row (`kind: "duplicate-start"`) and then starts a new one.
- `record_answer` appends the answer row and seals the record. With no open record it keeps a short record whose only row is `{ tool:"seal", kind:"duplicate-end" }`, and its receipt carries `error: "duplicate-end"`.
- Sealing closes a record for good: its trace is finished and never recomputed. A record that was never sealed stays marked incomplete in the panel.
- Conditions are stored with `set` before anything else, and `record_analyse` comes before the first `eval`. Computed numbers exist only after the `eval` that produced them; an answer quotes slot values or `get` results, never a number from memory.

### 7.1 Trace rows

Every engine operation appends exactly one self-describing JSON line to the open record's body — inputs and outputs both:

```json
{ "seq": 1, "tool": "marker", "kind": "question", "ok": true, "text": "…", "at": … }
{ "seq": 2, "tool": "set", "ok": true, "name": "R1", "value": { "type": "number", "value": 4700, "kind": "resistance" }, "rev": 1, "at": … }
{ "seq": 3, "tool": "get", "ok": true, "name": "R1", "format": null, "value": { …the stored value… }, "at": … }
{ "seq": 4, "tool": "eval", "ok": true, "formula": "@V_in*@R2/(@R1+@R2)", "target": "V_out", "rev": 1,
  "vars": { "V_in": { … }, "R1": { … }, "R2": { … } }, "result": { …the typed result… }, "at": … }
{ "seq": 5, "tool": "eval", "ok": true, "formula": "@R/@R", "target": null, "rev": null,
  "vars": { "R": { … } }, "result": { "type": "number", "value": 1, "kind": "none" }, "at": … }
{ "seq": 6, "tool": "set", "ok": true, "name": "tmp", "value": null, "deleted": false, "at": … }
{ "seq": 7, "tool": "eval", "ok": false, "code": "ENGINE_SLOT_UNDECLARED", "error": "…", "at": … }
{ "seq": 8, "tool": "marker", "kind": "analyse", "ok": true, "text": "…", "at": … }
{ "seq": 9, "tool": "marker", "kind": "answer", "ok": true, "text": "…", "at": … }
```

| field | meaning |
|---|---|
| `seq` | the row's position in the record, from 1 |
| `tool` | `set`, `get`, `eval`, `marker` or `seal` |
| `ok` | `true`, or `false` together with `code` and `error` |
| `at` | when the step happened |
| `value` | a `set` row's stored value, or the value a `get` row read; `null` marks a deletion |
| `rev` | the slot's revision after the write |
| `formula`, `target`, `vars`, `result` | the `eval` row: the expression as written, the slot it was written into (`null` for a pure evaluation), the slots the formula read mapped to their stored values, and the result |
| `code`, `error` | present on a failed row |

- `vars` holds exactly the slots the formula read, in first-use order; a successful `eval` row is written whether or not a target was given, and binding variables never enter the trace.
- The `get` receipt carries the printed text, while its trace row carries the stored value and the requested format (`null` when none was asked for): the record keeps facts, not formatted strings.
- A trace holds engine operations only: no kernel internals and no model reasoning. Its reader is a human, and every step shows its input and its output in place.
- **Every primitive appends a row to the open record**, so `set`, `get` and `eval` need one: with no record open the call fails with an `error` naming `record_question`.

### 7.2 Recovery by replay

A host that starts with a record still open — an index row with `sealedAt: null` whose body exists — rebuilds the variable table by replaying that record's rows in order:

| row | what the replay does |
|---|---|
| `set` | writes its value, or deletes the slot when the row is a deletion |
| `eval` with a target | writes the **stored** result into the target, without recomputing anything |
| `eval` with `target: null` | nothing |
| `marker`, `seal`, failed rows | skipped |

The trace then continues in the same file, with the sequence resuming after its last row. The stored results are taken as facts, so nothing is recomputed, nothing is fetched and nothing is random. A sealed record is history rather than state, and every one of its lines stays readable on its own.

### 7.3 Consistency

| situation | behaviour |
|---|---|
| an index row whose body file is missing while it is still open | cleared at engine start |
| an open record | the index row with `sealedAt: null` whose body exists; a restart recovers it from that pair |
| `state.json` | written by one owner as read-modify-write and replaced atomically, so a crash mid-write leaves the previous file; an unreadable file reads as `{}` |

## 8. Errors

Every failure is one receipt — `{ ok: false, code, error }` — and nothing is written:

- **`error` is the one sentence written for you.** It names the position in the text, the concrete value that failed and the fix. Read it and change that specific thing; do not retry the same call unchanged.
- **`code` is for machines**: the trace, the tests and the panel match on it. It never replaces the sentence.
- **A failed call has no side effects**: no slot is created, no value is changed, no revision moves.

The scheme is `ENGINE_<position>_<reason>`; the position segment says what has to change:

| position | meaning | what to do |
|---|---|---|
| `PARSE` | the source text is not valid | rewrite the text as the message says |
| `SLOT` | a name or a slot rule failed | check the name, or declare the slot first |
| `IDENT` | a bare identifier has no binding | write `@name`, or use a bounded notation |
| `DIM`, `TYPE` | the mathematics does not line up | fix the quantities or the operation |
| `RANGE` | an index or a domain is outside its range | fix the index or the input |
| `SYMBOL`, `TOOL` | the notation cannot be evaluated, or another tool failure | take another route, or fix the arguments |

Representative codes, and what their `error` carries:

| code | raised when | the `error` carries |
|---|---|---|
| `ENGINE_PARSE_SYNTAX` | the text is structurally invalid, or a formula is empty | the position, and `expected the closing parenthesis (')')`, `the formula is empty — write one expression, referencing slots with @name`, … |
| `ENGINE_PARSE_NUMBER` | a number literal is malformed (`1E5`, `2e`) | the position, `scientific notation takes a lowercase 'e'`, `'e' must be followed by digits (as in 1e5)`, and the rewrite to paste: `write "1e5"` |
| `ENGINE_PARSE_IDENT` | a single letter directly follows a number (`1R`, `2x`) | the position, and `an identifier cannot follow a number directly; to multiply, write "*" (as in "1*R")` |
| `ENGINE_PARSE_UNIT` | a unit, prefix or variant word is not accepted (`5k`, `4.7kΩ`, a bare word) | the position and what the word is: `'k' is a prefix and must be followed by a unit (p n u m k M G T); to write 5 metres use "5metre"`, or the whole unit vocabulary |
| `ENGINE_PARSE_SYMBOL` | `$` is followed by a name outside the notation table, or a function is written without parentheses | the position and the complete vocabulary |
| `ENGINE_PARSE_ARITY` | a notation was given the wrong number of arguments | the notation, the count it takes and the count it got |
| `ENGINE_SLOT_UNDECLARED` | `@name`, or `get`'s `name`, is not declared | the name, and that only the conditions the user gave or an earlier `eval` target exist |
| `ENGINE_SLOT_KIND` | a write would change a slot's pinned kind or type | the pinned identity and the incoming one, plus the delete-first fix |
| `ENGINE_IDENT_UNBOUND` | a bare identifier is not bound by any notation | the name, the notations that bind, and `to read a slot write "@name"` |
| `ENGINE_DIM_MISMATCH` | the derived dimension does not match, an operation mixes dimensions, an exponent carries a unit or a quantity is raised to a complex power, or a result has no named kind | both dimensions (or the unnamed one) and the fix, e.g. `write the count with its unit (for example 5volt), or multiply if that is what you mean`, `only a dimensionless base has a complex power`, `split the formula so each step lands on a named quantity` |
| `ENGINE_TYPE_MIXED_KIND` | an array literal mixes kinds | the element that broke it, its measure, and the first element's |
| `ENGINE_TYPE_NOT_ARITHMETIC` | a non-arithmetic value (an object, a string) took part in arithmetic | what was combined with what |
| `ENGINE_RANGE_INDEX` | an index or a bound is out of range | the index and the length, or the two bounds |
| `ENGINE_RANGE_DOMAIN` | a function is applied outside its domain: `$ln(-1)`, division by zero, `$mod` by zero | the function and its domain |
| `ENGINE_NOT_INDEXABLE` | something that is not an array was indexed | what was indexed |
| `ENGINE_NO_FIELD` | an object has no such field | the field, and the fields the object does have |
| `ENGINE_SYMBOL_NOT_EVALUABLE` | `$integral`, `$diff` or `$limit` was evaluated | the written form, and to state the closed form or say the value cannot be computed |
| `ENGINE_ARGS_INVALID` | an argument has the wrong shape: a bad slot name, an unknown `format`, arrays of different lengths | the expected shape and the received one |
| `ENGINE_UNSUPPORTED_VARIANT` | `get`'s `format` names a unit that does not express the value's kind (`format: "degC"` on a resistance) | the format word, the kind, and the unit that kind prints with |
| `ENGINE_TOOL` | the fallback, when no specific code applies | the internal error, as it is |

## 9. Storage and logs

The plugin home is `~/.dsh-reckoner`, and `DSH_RECKONER_HOME` moves it.

```
~/.dsh-reckoner/
  record-index.jsonl      index rows, one per record
  records/<id>.jsonl      trace bodies, one file per record
  state.json              plugin state
  logs/                   one file per host run
```

| file | holds |
|---|---|
| `record-index.jsonl` | `{ id, openedAt, sealedAt, question }` per record; `sealedAt: null` marks the record that is still open |
| `records/<id>.jsonl` | one trace line per engine operation |
| `state.json` | the remembered generation settings (`generateDir`, `generateLanguage`, `generateFormat`, `generateCompile`) |
| `logs/` | the run logs below |

### 9.1 Logs

One file per host run, `<logs>/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, created exclusively and held open. Every line is `<timestamp> <LEVEL> <message>[ k=v …]` and goes to the file and to stdout. A field value is a JSON scalar; a nested object or array is one token, and an Error becomes its message plus `  | ` continuation lines carrying the stack.

| setting | values |
|---|---|
| `DSH_RECKONER_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `off`; default `info` |
| retention | the newest 20 files, up to 50 MB |

The file describes its own run: the name is the start, the last line is the end, and a log whose last line is not `plugin unmounted` belongs to a run that was killed. The log carries the plugin's own diagnostics — mounts, endpoint failures, generation jobs — while a record holds engine operations only.

## 10. Article generation

Every record can be written up as a standalone solution article. The host flattens the record into plain facts, gives them to a model in a context of its own, and writes the article to disk. The article is written as the author's own solution: it never mentions Reckoner, the harness, formulas, derivation steps, records or the generation process, and the only allowed occurrences of the name are the fixed title `DeepSeek Harness Reckoner Solution` and the author line `DeepSeek Harness Reckoner`.

What the record contributes:

| fact | source in the record |
|---|---|
| the question | the index row's `question` |
| the conditions | the `set` rows, each as `name: <stored value>`, or `name: removed` for a deletion |
| the analysis | the `analyse` marker texts, under the list of established conditions |
| one derivation step per successful `eval` | its `formula`, the slots it substituted (`vars`) and its `result` |
| the answer | the `answer` marker text |

- Failed rows and `get` rows are skipped: the article is built from the derivation that succeeded and the numbers it produced.
- `formula` is what makes the derivation recoverable — the record is the only place the formula survives, so a step that is never taken leaves a gap the article cannot fill.
- Every number in the article must come from those steps and the answer; the generation prompt forbids inventing or recomputing one, and forbids reproducing the record's internal step labels as headings.
- **Formats**: Markdown (`.md`) and LaTeX (`.tex`). For LaTeX the host owns the document shell — XeLaTeX, `ctexart` for zh-CN and `article` with `fontspec` for en, plus amsmath, siunitx and unicode-math, with the fixed title and author — and the model writes the body only. PDF compilation is LaTeX-only and optional, driven by `latexmk` (or `texify`) around `xelatex`.
- **Language**: `auto` (the language of the question), `zh-CN` or `en`. The shell language is resolved before generation, so an auto job probes the question text.
- **Job phases**: prepare → generate → write → compile. A LaTeX job writes its source, its PDF and the compiler's artifacts into a folder named after the file; a Markdown job is written flat and is never compiled.
- The file name is forced to the format's extension, and defaults to `reckoner-<first 8 characters of the record id>` when none is given. The output directory, language, format and compile toggle are remembered in `state.json` (§9).

## 11. The panel

The records panel is a **Reckoner** entry in the sidebar that opens over the conversation column. It has two views: the records list and one record's detail.

### 11.1 Records list

- Reads `GET /api/dsh-reckoner/records-index` and polls it every 5 seconds; it never reads a trace body.
- Newest first. Each row shows the question — or the record id when the question is empty — and the time the record was opened.
- A record that is still open carries an **incomplete** badge.
- **Select** mode turns the rows into checkboxes with **Select all** and **Delete selected**, guarded by a confirmation dialog. Deleting removes the record's body and its index row; the record that is currently open cannot be deleted.

### 11.2 Record detail

- Fetched from `GET /api/dsh-reckoner/records/<id>` — the index meta plus the trace rows — and polled every 5 seconds while the record is open, so a running solve appears live.
- A title card with the record id, the visible row count, the failed row count and either the sealed time or the incomplete badge.
- **Display all** off keeps failed rows out of the timeline: they are the engine's account of the attempts, not part of the solution.
- Rows are grouped into the narrative: consecutive `set` rows collapse into one **Writes ({n})** card (one line per slot, with its revision), consecutive `get` rows into a **Reads ({n})** card, and consecutive failures into a red **Failed attempts ({n})** card showing the sequence number, the tool, the formula when there is one, the `code` and the `error` text.
- Every successful `eval` gets its own **Eval** card: **Formula**, **Written slot** with its revision (or *(evaluated without writing)* for `target: null`), one row per slot the formula read — `@name` with the stored value — chips that jump to the `set` row that created each of those slots, and **Result** as a tree.
- Marker rows render as accent-striped cards: **Question**, **Analysis**, **Answer**, **Duplicate open (settled as an error record)** and **Settled with no open record (error record)**.
- The right-hand column holds the two article buttons — **Generate Markdown** and **Generate LaTeX** — which open the generation setup dialog; progress, the written path and any compile error appear in an overlay that stays visible over both the panel and the session.

### 11.3 Host endpoints

| endpoint | purpose |
|---|---|
| `GET /api/dsh-reckoner/records-index` | the list's index rows |
| `GET /api/dsh-reckoner/records/<id>` | one record's index meta and trace rows |
| `DELETE /api/dsh-reckoner/records/<id>` | removes a record's body and index row; refused while it is open |
| `POST /api/dsh-reckoner/generate` | starts an article job (`recordId`, `format`, `directory`, `fileName`, `language`, `compile`) |
| `GET /api/dsh-reckoner/generate-progress` | polls the job |
| `POST /api/dsh-reckoner/generate-cancel` | cancels the job |
| `GET /api/dsh-reckoner/generate-capability` | the LaTeX toolchain check behind the setup dialog |
| `GET /api/dsh-reckoner/list-roots`, `GET /api/dsh-reckoner/list-dirs` | the directory browser |
| `GET` / `PUT /api/dsh-reckoner/generate-dir` | the remembered generation directory and settings |
| `POST /api/dsh-reckoner/reveal` | opens a generated file or its folder in the host's file manager |
