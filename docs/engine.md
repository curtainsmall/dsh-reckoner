# Reckoner Engine Manual

[简体中文](engine.zh-CN.md)

Every calculation in the Reckoner plugin happens inside one deterministic **engine**.
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
- [12. The outside lookup](#12-the-outside-lookup)

## 1. What the engine is

The **Engine** is a state machine that do evaluations:

- **No domain knowledge.** The engine knows nothing about any specific domain the LLM about to solve in, it only do mathmatical evaluation with the form given.
-  **No internal solvers.** The engine has no internal algorithm, nor embeded solutions. It is the caller's duty to decide what to calculation.

- **Numbers come from slots or from the formula's own literals.** The engine keeps no memory between calls other than the slot table, so every quantity in a derivation is a stored value or a constant written into the formula.
- **Deterministic.** The same slot table and the same formula produce the same value: no randomness, no clock in the arithmetic, no network.

## 2. The plugin surface

### 2.1 The six operations

| operation | arguments | success receipt |
|---|---|---|
| `set` | `name`, a slot name; `value`, a tagged value or `null` to delete the slot | `{ ok:true, name, rev, value }`, or `{ ok:true, name, rev:null, value:null }` for a deletion |
| `get` | `name`; the optional `form`, `digits` and `dim` | `{ ok:true, name, value }` |
| `eval` | `formula`, one expression; `target`, a slot name | `{ ok:true, target, rev }` |
| `record_start` | `title`, a non-empty string | `{ ok:true }` |
| `record_message` | `text`, a non-empty string; the optional `hide`, a boolean | `{ ok:true }` |
| `record_end` | the optional `text`, a string | `{ ok:true }` |

- `set`, `get` and `eval` are refused while no record is open (Section 7.1).
- `name` and `target` are bare slot names, never `@name`: the `@` form exists only inside a formula (Section 4.3).
- `set` stores a value and echoes what was stored; `get` is the only operation that returns a value.
- `eval` does not return its value. The receipt names the slot that was written and its new revision; the value is read with `get` or referenced as `@name` in a later formula.

### 2.2 Receipts

Every call answers with one JSON receipt, and there is no second failure channel:

```
success: set  -> { ok:true, name, rev, value }    delete: { ok:true, name, rev:null, value:null }
         get  -> { ok:true, name, value }
         eval -> { ok:true, target, rev }
         markers -> { ok:true }
failure:      -> { ok:false, code, error }
```

`error` is one sentence written for the reader: the concrete value that failed, the boundary or the expectation, and the fix. `code` is the stable machine-readable half of the same failure (Section 8). A failed call changes no slot and no revision; when a record is open, the failure is nevertheless appended to it as a row with `ok: false` (Section 7.2).

### 2.3 The slot table and its rules

- A **name** is an identifier: a letter or underscore, then letters, digits or underscores. The same rule covers slot names, `eval` targets, object field names and bound variable names.
- A **write** to a name that does not exist creates the slot at revision 1.
- An **overwrite** replaces the value and increments the revision by one.
- A **delete** is `set` with `value: null`, idempotent: deleting a missing slot is still `ok`, and the slot is recreated at revision 1.
- A **failed** operation writes nothing.
- The **lifetime** is the record's: `record_end` clears the table, so a non-empty table means a record is open.

## 3. Values

### 3.1 The four value types

| type | numeric| dimension |
|---|---|---|
| `number` | one JSON number (`num`) | SI dimension |
| `complex` | `re` and `im` as JSON numbers, stored rectangular | SI dimension |
| `array` | each a number, a complex or a nested array | SI dimension; shared by every element |
| `object` | each a full value | one SI dimension per field; the object carries none of its own |

- SI dimension vector: SI dimension are represented as 7 integer exponents in ISO 80000-1 order (m, kg, s, A, K, mol, cd). Two values with the same SI dimension vector are the same quantity however they are spelled, and the kind label of Section 6.1 is a name for humans: it is never stored and never decides anything.
- A numeric position holds a JSON number only, that is, a finite double. A string, a boolean or `null` in a numeric position is `ENGINE_INVALID_ARGS`.
- Only whole vectors reach a slot: a vector with a fractional exponent is refused before anything is written (Section 6.4).

### 3.2 `set`'s tagged structure

`set`'s `value` is a JSON object carrying exactly one tag, plus the optional `dim`:

```
{"num": 4.7e3}                               a real
{"re": 3, "im": 4}                           a complex, rectangular
{"mag": 5, "ang": 0.927295218}               a complex, polar (radians)
{"array": [1, 2, 3]}                         an array
{"object": {"v": {"num": 12}}}               an object
```

- **Exactly one tag.** The tags are `num`, `re` with `im`, `mag` with `ang`, `array` and `object`; a bag with none or with more than one is `ENGINE_INVALID_ARGS`. An unknown key is refused with the tag vocabulary, and `dim` beside `object` is refused because an object takes its dimensions per field.
- **Both halves of a pair.** `re` without `im` and `mag` without `ang` are refused, each naming the pair it needs.
- **Polar is converted on entry.** `mag` and `ang` become `re = mag*cos(ang)` and `im = mag*sin(ang)`; the stored value is always rectangular.
- **Array elements are bare.** An element is a number, `{re,im}`, `{mag,ang}` or a nested array, and it carries no tag of its own and no `dim`, because the whole array shares one dimension. An object can never be an element of an array.
- **An object carries one `dim` per field.** `object` maps field names to full values parsed by this same rule, so a field may itself be an object; a field name must satisfy the name rule of Section 2.3.

### 3.3 `dim`

`dim` is the spelling of the value's SI dimension (physical dimension):

- A dimension **name**, in which case the numeric may be convertedt to make sure the dimension can be represented with SI dimension (Section 6.1).
- **7 integers** in the order m,kg,s,A,K,mol,cd.
- Omitted or `null`: the zero vector.

- Any other value is `ENGINE_INVALID_DIMENSION`

### 3.4 `get`

`get {name, form?, digits?, dim?}` reads one slot. Reading never changes what is stored.

| option | meaning |
|---|---|
| `form: "rect"` | every scalar leaf rendered `{re, im}` |
| `form: "polar"` | every scalar leaf rendered `{mag, ang}`, radians |
| `form` omitted | the stored form: a real stays `{num}` |
| `digits` | round every number to that many significant digits, never padded |
| `dim`, a dimension name | convert value to that dimension |
| `dim`, 7 integers | check the stored SI dimension vector, convert nothing, echo the integers |
| `dim` omitted | the SI dimension vector's first dimension name, or the 7 integers |

- `form`, `digits` and `dim` reach every scalar leaf alike: an object's fields and an array's elements included.
- A dimension name of the wrong vector, or 7 integers that differ from the stored vector, are `ENGINE_INCOMPATIBLE_DIMENSION`.
- A `dim` that does not match the stored vector is refused with `ENGINE_INCOMPATIBLE_DIMENSION`, naming both SI dimension vectors; an object is checked field by field, and nothing is converted.
- A negative real under `polar` is `{mag: -x, ang: pi}`; a real under `rect` is `{re: x, im: 0}`.
- `form` must be `"rect"` or `"polar"`, and `digits` must be a positive integer; anything else is `ENGINE_INVALID_ARGS`.
- Receipts: a real is `{num, dim}`, a complex is `{re, im, dim}` or `{mag, ang, dim}`, an array is `{array: [bare elements], dim}` with a bare number, a `{re,im}`/`{mag,ang}` scalar or a nested array per element, and an object is `{object: {field: <receipt>}}` with no `dim` at its own level.

## 4. Formulas

### 4.1 The charset and the literals

A formula is ASCII. The scanner accepts digits; names (a letter or underscore, then letters, digits or underscores); `$name`; `@name`; the whitespace characters space, tab and newline; and the punctuation `+ - * / ^ ( ) [ ] { } , . _ =` together with the two-character token `->`. Any other character is refused with `ENGINE_INVALID_FORMULA`, whose message names the character, its code point and the whole charset.

| literal | reads as |
|---|---|
| `12`, `4.7` | a real; the fraction needs a digit after the point |
| `1e5`, `2.5e-3` | a real in scientific notation: a lowercase `e`, an optional sign, and at least one exponent digit |
| `2j`, `4i` | an imaginary scalar (`{re: 0, im: 2}`); `i` and `j` are the imaginary suffix |
| `2.5j`, `1e3i` | the same suffix on a fraction or an exponent |

- A scalar literal is always dimensionless.
- An `e` with no exponent digits is `ENGINE_INVALID_NUMBER`.
- A letter directly after a number is `ENGINE_INVALID_IDENTIFIER`: a letter may follow a number only as the imaginary suffix `i` or `j`. `1E5` and `2x` are refused; for the second the message gives the rewrite `2*x`.
- There is no boolean literal, no string literal, no dimension literal and no array or object literal: a formula has numbers, slots and notation only.

### 4.2 The grammar

```
formula        := additive EOF
additive       := multiplicative (('+' | '-') multiplicative)*
multiplicative := unary (('*' | '/') unary)*
unary          := ('-' | '+') unary | power
power          := postfix ('^' unary)?
postfix        := primary ('[' additive ']' | '.' NAME)*
primary        := NUMBER | NAME | SLOT | SYMBOL | '(' additive ')'
SLOT           := '@' NAME
SYMBOL         := '$' NAME
                | '$' NAME '(' args ')'
                | '$' NAME '_' '{' subscript '}' '^' '{' additive '}' '(' args ')'
                | '$' NAME '_' '{' subscript '}' '(' args ')'
subscript      := NAME '=' additive | NAME '->' additive | additive
args           := [ additive (',' additive)* ]
```

- The four `SYMBOL` shapes are the constant, the function, the bounded form with both positions, and the form with a subscript only (`$diff` and an unbounded `$integral` are written in the second shape). Which shapes a symbol accepts, and how many arguments it takes, is the notation table's business (Section 5).
- A formula is exactly ONE expression: a token following a complete expression is `ENGINE_INVALID_FORMULA`, not a second statement.
- Precedence runs additive, multiplicative, unary, power, postfix, primary: `*` and `/` bind tighter than `+` and `-`, a unary sign binds looser than `^` on the left, and `^` is right-associative. `-2^2` is `-4`, and `2^3^2` is `2^(3^2)`.
- A leading `+` is dropped; a leading `-` negates.
- Multiplication must be written `*`. `2@R`, `2$pi` and `2(3)` are all refused.
- A position is the brace directly after a notation name, so every other `^` is the power operator: `$e^(2)` and `$pi^2` are powers, while `^` followed by `{` is refused.
- Parentheses group; a `(` or `[` that is never closed is refused, naming the character that opened it.

### 4.3 Data access

- `@name` reads the value of one slot.
- `@name[index]` reads one element of an array; the index is an additive expression.
- `@name.field` reads one field of an object; the field name is a literal name, not an expression.
- Chaining: `@net.ports[0].z` reads indices and fields in one path.
- `@name` only ever reads; the slot a call writes is `eval`'s `target` parameter (Section 2.1). Nothing stores a reference, and no reference ever appears in a value or a receipt.
- A slot that does not exist is `ENGINE_SLOT_NOT_FOUND`.
- An index must evaluate to an integerr: a number, or a complex with `im` 0. Anything else, and an index outside `0..len-1`, is `ENGINE_INVALID_INDEX`; the second names the length.
- `[ ]` on a value that is not an array, and `.` on a value that is not an object, are `ENGINE_UNSUPPORTED_INDEX`. A field the object does not have is `ENGINE_FIELD_NOT_FOUND`, and the message lists the fields it has.
- A bare name is a bound variable (Section 5.4); any other bare name is `ENGINE_NAME_NOT_BOUND`, whose message gives the rewrite `@name`.

### 4.4 Arrays

- An array's elements share one dimension, and a nested array shares it too, so the whole structure carries exactly one vector.
- An operator applies element by element. Two arrays must have the same length, otherwise `ENGINE_INVALID_ARGS` names both lengths; a scalar on one side is broadcast over every element of the other.
- A unary function maps over the elements and re-collects them, keeping the vector. `$len` counts the elements instead, and `$transpose` rearranges a rectangular two-dimensional array (Section 5.3).
- No operator and no function is defined on an object: a field is read first (Section 4.3). The refusal is `ENGINE_UNSUPPORTED_OPERATION`, and the same code refuses an object built as an array element.
- There is no matrix algebra: `$seq` builds arrays, `[i]` indexes them, and `$transpose` transposes an array of arrays.

### 4.5 Powers

- An exponent must have the dimensionless, otherwise `ENGINE_INCOMPATIBLE_DIMENSION`.
- A real exponent scales the base's vector by the exponent, so `(4volt)^2` measures `volt^2` (Section 6.2).
- A complex exponent requires a dimensionless base, because `a^z` is `exp(z*Log a)`: the result is dimensionless, and a zero base is `ENGINE_UNDEFINED_RESULT`.
- `0^0` is 1, zero to a negative power is `ENGINE_UNDEFINED_RESULT`, and a negative real base under a fractional exponent is `ENGINE_UNDEFINED_RESULT` because it has no real value.
- A result is a complex when either operand is a complex, or when its imaginary part is not zero; otherwise it is a real.

### 4.6 `eval`'s target

- `target` is required and is a bare slot name.
- The result must have a dimension of SI dimension vector whose components are integers: a fractional one is refused before anything is written (Section 6.4).
- The target is written unconditionally: the write replaces whatever the slot held and increments its revision (Section 2.3).
- One call produces one trace row, so each evaluated step leaves its own formula and result in the record (Section 7.2).

### 4.7 What the language does not have

No assignment, no comparison, no logic, no conditional and no statement sequence: there is no `if`, no `==`, no `&&`, no `x = ...` and no way to write two expressions in one call. `=` exists only inside a subscript (`_{k=a}`), where it binds. There is no user-defined function, no comment syntax, and no literal for a dimension or a dimension.

## 5. Notation

### 5.1 The namespace and the positions

- Every notation name starts with `$`. That namespace is the engine's own: a slot name (`sum`, `abs`, `ohm`) can never collide with a notation, and no name is reserved.
- A `$name` outside the table is `ENGINE_INVALID_NOTATION`.
- A notation may carry a subscript `_{...}` and/or an superscript `^{...}`, each written as the brace directly after the notation name: `$sum_{k=a}^{b}(body)`. A subscript holds either the notation's binding form `name = expression` or `name -> expression`, or a plain expression; a bare name inside a position is still a bound variable.
- A constant takes no parenthesis and no position; a function takes its arguments in parentheses only; a bounded form takes its bounds in positions and its body in parentheses.
- Argument counts are checked against the table (Section 5.2, Section 5.3, Section 5.4), and a wrong count is `ENGINE_INVALID_ARITY`.

### 5.2 Constants (5)

| notation | written form | meaning |
|---|---|---|
| `$pi` | bare | the ratio of a circle's circumference to its diameter |
| `$e` | bare | the base of the natural logarithm |
| `$inf` | bare | positive infinity |
| `$i` | bare | the imaginary dimension |
| `$j` | bare | the imaginary dimension, the engineering spelling |

A constant takes no arguments and no position: `$pi()` and `$pi_` are refused, and a power is written with `^` (`$e^(2)`, `$pi^2`).

### 5.3 Functions (20 unary, 4 binary)

| notation | written form | meaning |
|---|---|---|
| `$abs` | `$abs(x)` | absolute value (the magnitude of a complex) |
| `$sqrt` | `$sqrt(x)` | square root; the principal complex root of a complex argument |
| `$exp` | `$exp(x)` | `e` raised to the argument |
| `$ln` | `$ln(x)` | natural logarithm (the principal one for a complex argument) |
| `$log` | `$log(x)` | base-10 logarithm |
| `$sin` | `$sin(x)` | sine |
| `$cos` | `$cos(x)` | cosine |
| `$tan` | `$tan(x)` | tangent |
| `$asin` | `$asin(x)` | inverse sine, in radians |
| `$acos` | `$acos(x)` | inverse cosine, in radians |
| `$atan` | `$atan(x)` | inverse tangent, in radians |
| `$floor` | `$floor(x)` | largest integer not greater than the argument |
| `$ceil` | `$ceil(x)` | smallest integer not less than the argument |
| `$sign` | `$sign(x)` | sign of the argument: -1, 0 or 1 |
| `$re` | `$re(x)` | real part |
| `$im` | `$im(x)` | imaginary part |
| `$arg` | `$arg(x)` | argument (phase) in radians |
| `$conj` | `$conj(x)` | complex conjugate |
| `$len` | `$len(a)` | the number of elements of an array |
| `$transpose` | `$transpose(M)` | the transpose of a rectangular two-dimensional array |
| `$atan2` | `$atan2(x, y)` | the angle of the point `(x, y)`, in radians |
| `$min` | `$min(a, b)` | the smaller of two arguments |
| `$max` | `$max(a, b)` | the larger of two arguments |
| `$mod` | `$mod(a, b)` | the remainder of `a` divided by `b` |

A function is always written with parentheses; a subscript on one is refused, and either form of misuse repeats the written form from this table.

### 5.4 Bounded forms (6)

| notation | written form | arguments | evaluable | meaning |
|---|---|---|---|---|
| `$sum` | `$sum_{k=a}^{b}(body)` | 1 | yes | the body accumulated with `+` as the variable runs from the lower to the upper bound |
| `$prod` | `$prod_{k=a}^{b}(body)` | 1 | yes | the body accumulated with `*` over the same range |
| `$seq` | `$seq_{k=a}^{b}(body)` | 1 | yes | the body collected into an array over the same range |
| `$integral` | `$integral_{a}^{b}(body, x)` or `$integral(body, x)` | 2 | no | a definite integral; the second argument names the variable |
| `$limit` | `$limit_{x->a}(body)` | 1 | no | a limit, with the variable bound by `->` |
| `$diff` | `$diff(body, x)` or `$diff(body, x, n)` | 2 or 3 | no | a derivative, of order `n` when given |

- Both bounds are required for `$sum`, `$prod`, `$seq` and the bounded `$integral`; `$limit` takes the subscript only, `$diff` takes neither, and `$integral` accepts either both or neither.
- A bound is evaluated once, before the body, and must be an integer with the zero vector, otherwise `ENGINE_INVALID_INDEX`. The range is inclusive, and a lower bound above the upper one is `ENGINE_INVALID_INDEX`.
- At each step the variable is bound to a dimensionless real. Binding it is the only way a bare name acquires a value, and the binding is visible only inside the notation's own body.
- `$seq` yields an array; `$sum` and `$prod` fold the collected values with `+` and `*`, so their result follows the vector arithmetic of those operators.
- `$integral`, `$limit` and `$diff` can be written but not evaluated. Evaluating one is `ENGINE_UNSUPPORTED_SYMBOL`, whose message repeats the written form. They exist so that a formula can still state what it means; the closed form has to be evaluated instead.

## 6. Dimensions

### 6.1 The name table

The engine's only vocabulary of dimensions is this table. A name maps to a SI dimension vector, a SI dimension vector maps back to its row, and nothing else in the engine may spell a dimension.

| vector | kind | names |
|---|---|---|
| `[0,0,0,0,0,0,0]` | `dim-less` | `dim-less`, `radian`, `steradian` |
| `[0,0,1,0,0,0,0]` | `time` | `second` |
| `[1,0,0,0,0,0,0]` | `length` | `metre` |
| `[0,1,0,0,0,0,0]` | `mass` | `kilogram` |
| `[0,0,0,1,0,0,0]` | `current` | `ampere` |
| `[0,0,0,0,1,0,0]` | `temperature` | `kelvin`, `degC` |
| `[0,0,0,0,0,1,0]` | `amount-of-substance` | `mole` |
| `[0,0,0,0,0,0,1]` | `luminous-intensity` | `candela`, `lumen` |
| `[0,0,-1,0,0,0,0]` | `frequency` | `hertz`, `becquerel` |
| `[1,1,-2,0,0,0,0]` | `force` | `newton` |
| `[-1,1,-2,0,0,0,0]` | `pressure` | `pascal` |
| `[2,1,-2,0,0,0,0]` | `energy` | `joule` |
| `[2,1,-3,0,0,0,0]` | `power` | `watt` |
| `[0,0,1,1,0,0,0]` | `charge` | `coulomb` |
| `[2,1,-3,-1,0,0,0]` | `voltage` | `volt` |
| `[-2,-1,4,2,0,0,0]` | `capacitance` | `farad` |
| `[2,1,-3,-2,0,0,0]` | `resistance` | `ohm` |
| `[-2,-1,3,2,0,0,0]` | `conductance` | `siemens` |
| `[2,1,-2,-2,0,0,0]` | `inductance` | `henry` |
| `[2,1,-2,-1,0,0,0]` | `magnetic-flux` | `weber` |
| `[0,1,-2,-1,0,0,0]` | `flux-density` | `tesla` |
| `[-2,0,0,0,0,0,1]` | `illuminance` | `lux` |
| `[2,0,-2,0,0,0,0]` | `absorbed-dose` | `gray`, `sievert` |
| `[0,0,-1,0,0,1,0]` | `catalytic-activity` | `katal` |

- The components are read in the order m, kg, s, A, K, mol, cd.
- An SI dimension vector with no row has no kind: the engine calls it `unnamed`, and it is mentioned by its 7 integers.
- The first name of a row is the one the engine mentions, in a message and in a `get` receipt without `dim`; the further names are accepted spellings of the same vector.
- Every name carries an affine map `SI = x*factor + offset`. `degC` is the only name whose map is not the identity: its factor is 1 and its offset is 273.15. Every other name has factor 1 and offset 0.
- The table holds SI names only. Any other dimension is converted by the caller before `set` (Section 1).

### 6.2 Vector arithmetic

| operation | vector of the result |
|---|---|
| `a + b`, `a - b` | the shared vector; different vectors are refused |
| `a * b` | the component-wise sum |
| `a / b` | the component-wise difference |
| `a ^ p`, real `p` | every component of `a` scaled by `p` |

- A scalar literal and every zero SI dimension vector values are dimensionless. A dimensionless factor multiplies without changing the other side's vector (`2*@R` is a resistance), while adding one to a dimensional value is refused, because a bare count does not say what it counts.
- `$min`, `$max`, `$mod` and `$atan2` require both arguments to carry the same dimension (Section 6.3).

### 6.3 The dimension rule of every notation class

| notation | argument dimension| result dimension |
|---|---|---|
| `$pi`, `$e`, `$inf`, `$i`, `$j` |-| dimensionless |
| `$abs`, `$re`, `$im`, `$conj` | any | the argument's dimension |
| `$arg` | any | dimensionless (radians) |
| `$sqrt` | any | half the argument's dimension |
| `$exp`, `$ln`, `$log`, `$sin`, `$cos`, `$tan`, `$asin`, `$acos`, `$atan`, `$floor`, `$ceil`, `$sign` | dimensionless; anything else is `ENGINE_INCOMPATIBLE_DIMENSION` | dimensionless |
| `$len` | any dimension, on an array | dimensionless |
| `$transpose` | any dimension, on a rectangular two-dimensional array | the same dimension |
| `$atan2` | both the same dimension| dimensionless (radians) |
| `$min`, `$max`, `$mod` | both the same dimension; different ones are `ENGINE_INCOMPATIBLE_DIMENSION` | the same dimension |
| `$sum`, `$prod` | the bound variable is a dimensionless real | whatever the fold of the body yields |
| `$seq` | the bound variable is a dimensionless real | the body's dimension, shared by the array's elements |

Beyond the dimension rules, some arguments are restricted in value:

- `$ln`, `$log`: a real argument must be greater than 0; `$ln(0)` and `$ln(-1)` are `ENGINE_UNDEFINED_RESULT`.
- `$sqrt` of a negative real is `ENGINE_UNDEFINED_RESULT`; a complex argument gives the principal root.
- `$asin` and `$acos` of a real argument outside -1 to 1 are `ENGINE_UNDEFINED_RESULT`.
- `$floor`, `$ceil`, `$sign` and the four binary functions require a real argument: a complex one is `ENGINE_UNDEFINED_RESULT`.
- Division by zero and `$mod` by zero are `ENGINE_UNDEFINED_RESULT`.

### 6.4 Integer dimension only

- An intermediate may carry a fractional dimension: `$sqrt` halves the dimension and a power scales it.
- Only the value written into a slot must have a whole vector. A fractional one is refused with `ENGINE_INCOMPATIBLE_DIMENSION` before anything is written, so a formula that produces a square root of a resistance is refused rather than stored.
- An intermediate dimension that names no row is perfectly legal: `(@V)^2/@R` squares a voltage on the way to a power, and `volt^2` is never a table row that has to exist.

### 6.5 A `dim` read as a claim

A `dim` given to `get` is a claim about what the slot holds: 7 integers must equal the stored vector exactly, and a table name must be a row of the same vector, after which the leaves are converted into that spelling. A mismatch is refused and nothing is converted (Section 3.4).

## 7. Records and the trace

### 7.1 The three markers

| marker | argument | effect |
|---|---|---|
| `record_start` | `title`, a non-empty string | opens a record; fails with `ENGINE_OPEN_RECORD_FOUND` while one is open, so a record carries exactly one title |
| `record_message` | `text`, a non-empty string; optional `hide`, a boolean | appends one explanation to the open record |
| `record_end` | optional `text` | appends the closing row, renames the open file into the closed tier (Section 7.3), clears the slot table; fails with `ENGINE_OPEN_RECORD_NOT_FOUND` when no record is open |

- `set`, `get` and `eval` require an open record, and so does `record_message`; without one the call fails with `ENGINE_OPEN_RECORD_NOT_FOUND`, and nothing is written anywhere.
- The record identifier is the clock reading in milliseconds as a string.
- A message with `hide: true` is marked as a note for the article writer rather than for the record view (Section 10).
- A closing text that is empty or only whitespace counts as absent.
- Each marker answers `{ ok: true }` and nothing else.

### 7.2 Trace rows

Every call appends at most one row to the open record, inputs and outputs alike. A call made while no record is open appends nothing.

```
{ "seq": 4, "at": 1700000000004, "tool": "eval", "ok": true, "content": { ... } }
```

| field | meaning |
|---|---|
| `seq` | the row's position in the record, from 1 |
| `at` | the clock reading of the call, in milliseconds |
| `tool` | `set`, `get`, `eval`, `record_start`, `record_message`, `record_end` or `search` |
| `ok` | `true`, or `false` for a refused call |
| `content` | what that tool stores |

`content` by tool:

- `set`: `{ name, value }`, the stored value with its `dim` as 7 integers; a deletion is `{ name, value: null }`.
- `get`: `{ name, value }`, the value as rendered for the receipt. The `form`, `digits` and `dim` asked for are not stored.
- `eval`: `{ formula, target, rev, vars, result }`, the text as written, the slot written, its new revision, every slot the formula read, and the result.
- `record_start`: `{ title, record }`.
- `record_message`: `{ text }`, or `{ text, hide: true }`.
- `record_end`: `{ record }`, or `{ text, record }` with a closing text.
- `search`: `{ question, tier, outcome, candidates, used, policy, synthesis?, error?, durationMs }` (Section 12.5).

- `vars` holds exactly the slots the formula read, in first-use order, each with the value the slot held at that moment. A bound variable never enters the trace.
- The record keeps facts, not formatted strings: a `get` row stores the value, not the options that produced its rendering.
- A `search` row is written by the tool that ran the lookup, never by the model: the row is the record's account of the retrieval, and the model receives the answer alone (Section 12). It is a fact like a `get` row, so recovery does not recompute it.
- A trace that cannot be written does not turn a successful call into a failure: the append failure is dropped.

### 7.3 The record file

- The first line of every record file is its header, `{"seq": 0, "version": 1}`. `seq: 0` is the only marker that distinguishes it from a trace row, and `version` is the design version this build writes and accepts.
- **Two tiers.** The one unclosed record lives in `<home>/open-record.jsonl`. Closing renames that file into `<home>/records/<id>.jsonl` in one atomic step, so a file under `records/` is always a complete record.
- **The version gate.** A file whose first line is not a header, or whose version is below the current one, is refused by every reader: at start the open file is discarded, and a closed record is not listed as a row but its identifier is reported among the identifiers that cannot be read.
- A line that does not parse is dropped, so a torn last line from a crash mid-append costs only that line: the record keeps every row that parsed.

### 7.4 Recovery by replay

At start the engine clears the slot table and then reads the unclosed file. A file that fails the version gate, or whose start row carries no title or no identifier, is discarded. Otherwise the record is resumed from its start row, with the last row's `seq`, and its rows are replayed in order:

- A `set` row that succeeded: writes the stored value, or deletes the slot when its value is `null`.
- An `eval` row that succeeded: writes the stored result into its target, without recomputing anything.
- A `search` row, a `get` row and any other row: skipped.

- The stored results are taken as facts: nothing is recomputed, nothing is fetched, nothing is looked up again and nothing is random.
- A row that no longer parses is skipped, so recovery can never keep the plugin from mounting.
- The trace then continues in the same file, the next row following the last one's `seq`.

### 7.5 The record list

- The list reports the closed records (identifier, version, title, opened time, ended time), the one open record (identifier, title, opened time) and the identifiers that cannot be read.
- The title and the span of a record come from its rows: the first accepted `record_start` row's title, the last accepted `record_end` row's time as the end, and the last row's time when there is none.
- The closed list is cached and rebuilt when the modification time of the `records/` directory changes, so a scan does not run on every read.

## 8. Errors

### 8.1 The failure shape

Every failure is one receipt, `{ ok: false, code, error }`, and it writes nothing:

- **`error` is one sentence written for the reader.** Where the failure concerns the text, it carries the position in it; it always carries the concrete value that failed, the boundary or the expectation, and the fix.
- **`code` is for machines.** The trace, the tests and the panel match on it. (Section 8.2).
- **A failed call has no side effects.** No slot is created, no value changes and no revision moves.  (Section 7.2).
- An unexpected internal fault is reported as `ENGINE_UNKNOWN_ERROR` with the message `internal error: ...`, so no failure ever escapes the receipt.

### 8.2 Error codes

| code | raised when |
|---|---|
| `ENGINE_INVALID_FORMULA` | the text is not one expression the grammar accepts |
| `ENGINE_INVALID_NUMBER` | a number's scientific form has no exponent digits, as in `2e` |
| `ENGINE_INVALID_IDENTIFIER` | a letter directly follows a number, as in `1E5`; or a name where an identifier is required is not a string, or breaks the name rule |
| `ENGINE_INVALID_DIMENSION` | `dim` is not a table name, not exactly 7 integers, or not made of integers |
| `ENGINE_INVALID_NOTATION` | a `$name` outside the notation table, or a notation written in a form it does not take |
| `ENGINE_INVALID_ARITY` | the argument count is not one the table lists, or a bound or subscript is missing or misplaced |
| `ENGINE_SLOT_NOT_FOUND` | `@name` reads a slot that does not exist, or `get` names one |
| `ENGINE_NAME_NOT_BOUND` | a bare name is not bound by any enclosing notation |
| `ENGINE_INCOMPATIBLE_DIMENSION` | two vectors must match, or an argument must be dimensionless, and they do not |
| `ENGINE_UNSUPPORTED_OPERATION` | an operator or a function applied to an object, or an object placed in an array |
| `ENGINE_INVALID_INDEX` | an index or bound that is not an integer with the zero vector, an index outside the array, or a lower bound above the upper one |
| `ENGINE_UNDEFINED_RESULT` | a value the engine defines none for |
| `ENGINE_UNSUPPORTED_INDEX` | `.` applied to a value that is not an object, or `[ ]` to a value that is not an array |
| `ENGINE_FIELD_NOT_FOUND` | an object has no field of that name; the message lists the fields it has |
| `ENGINE_UNSUPPORTED_SYMBOL` | `$integral`, `$limit` or `$diff` is evaluated |
| `ENGINE_INVALID_ARGS` | a tool argument has the wrong shape |
| `ENGINE_OPEN_RECORD_NOT_FOUND` | `set`, `get`, `eval`, `record_message` or `record_end` is called with no record open |
| `ENGINE_OPEN_RECORD_FOUND` | `record_start` is called while a record is open |
| `ENGINE_UNKNOWN_ERROR` | an unexpected internal fault, reported as `internal error: ...` |
## 9. Storage and logs

### 9.1 The home directory

The plugin home is `~/.dsh-reckoner`, and `DSH_RECKONER_HOME` moves it.

```
~/.dsh-reckoner/
  open-record.jsonl       the one unclosed record: its header line and its trace rows
  records/<id>.jsonl      closed records, one file each, named by the record identifier
  state.json              the plugin's remembered settings
  logs/                   one file per host run
```

| file | holds |
|---|---|
| `open-record.jsonl` | the unclosed record, rewritten from its header on `record_start` and renamed on `record_end` |
| `records/<id>.jsonl` | a closed record: the header line and one trace row per call |
| `state.json` | the remembered settings, as the tree below: one subtree per module that remembers settings, plus the flat `restartRequired` marker. It is replaced atomically, and a missing, corrupt or non-object file reads as `{}` |
| `logs/` | the run logs below |
### 9.2 Logs

- One file per plugin mount, that is per host run: `<home>/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, created exclusively and held open. Writing is synchronous on the held descriptor.
- A line is `<timestamp> <LEVEL> <message>[ k=v ...]`, and it goes to the file and to stdout. A field value is a JSON scalar; a nested object or array is one token; an Error is rendered as its message with `  | ` continuation lines carrying the stack.
- The level comes from `DSH_RECKONER_LOG_LEVEL`: `debug`, `info`, `warn`, `error` or `off`; anything else keeps the default `info`.
- Retention keeps the newest 20 run files, at most 50 MB in total.
- The log carries the plugin's own diagnostics (mount and unmount, endpoint failures, generation jobs), while a record carries engine calls only.

## 10. Article generation

A closed record can be written up as a standalone solution article. The host reduces the record's rows to plain facts, gives them to a model in a context of its own, and writes the article to disk. The record that is still open cannot be generated.

| fact | source in the record |
|---|---|
| the title | the first accepted `record_start` row's `title` |
| the conditions | the accepted `set` rows, accumulated per slot name; a deletion removes the name |
| the messages | the accepted `record_message` rows, each with its `seq` and its `hide` flag |
| the steps | the accepted `eval` rows carrying a formula: `seq`, `formula`, the slots it read and its result |
| the lookups | the `search` rows that answered: `seq`, the question, the answer and the sources it relied on |
| the closing text | the last accepted `record_end` row's `text` |

- Refused rows and `get` rows carry nothing to write, so they are skipped.

- A message with `hide: true` becomes an author's note: guidance that must not be copied, quoted, or allowed to change a recorded number. One without `hide` becomes the record's own explanation.
- Every number is cut before it reaches the model: four decimals at most, exponential form below `1e-3` or at least `1e6`. A field named `dim` keeps its 7 integers. The record keeps the stored numbers.
- A lookup is handed over as its own entry: the question, the answer as recorded, and one line per source. The answer stays verbatim, so the cut does not apply to it (Section 12.7).
- An open-tier answer is marked as looked up on the open web and not verified; the writer must keep its number and dimension as quoted, and credit the source.
- **Formats.** Markdown (`.md`) and LaTeX (`.tex`). The model writes a LaTeX body only; the host refuses document-restructuring commands, unbalanced braces or an odd number of `$`, and wraps the rest in a XeLaTeX shell: `ctexart` for zh-CN, `article` with `fontspec` for en.
- **Language.** `auto`, `zh-CN` or `en`, resolved before generation: an auto job probes the record's own prose for CJK ideographs.
- **Job phases.** prepare, generate, write, compile. A LaTeX article goes into a folder named after the file; a Markdown article is written flat.
- PDF compilation is LaTeX-only and optional: a driver, `latexmk` preferred and `texify` as the fallback, runs `xelatex`. A compile failure is reported without discarding the article.
- The file name is forced to the format's extension and defaults to `reckoner-<first 8 characters of the record identifier>`.
- The prompt forbids mentioning Reckoner, the harness, formulas, derivation steps, records or the generation process, and forbids inventing or recomputing a number.
- **Remembered settings.** Each format remembers its own output `directory`, its `language` and - LaTeX alone - whether to `compile` (Section 9.1).
- The settings endpoint serves that view: `GET /api/dsh-reckoner/settings`, and `PUT` takes `{generation: {format, directory?, language?, compile?}}` (Section 11.3).




## 11. Host endpoints

| endpoint | purpose |
|---|---|
| `GET /api/dsh-reckoner/records-index` | the closed records, the open record and the identifiers that cannot be read |
| `GET /api/dsh-reckoner/records/<id>` | one record's identity and trace rows; the open record included, with `endedAt: null` |
| `DELETE /api/dsh-reckoner/records/<id>` | removes a closed record's file; refused with 409 while it is the open record, 404 when it does not exist |
| `POST /api/dsh-reckoner/generate` | starts an article job (`recordId`, `format`, `directory`, `fileName`, `language`, `compile`) |
| `GET /api/dsh-reckoner/generate-progress` | polls one job's status, percent, phase, path and error |
| `POST /api/dsh-reckoner/generate-cancel` | cancels a running job |
| `GET /api/dsh-reckoner/generate-capability` | the LaTeX toolchain and document-shell probe behind the setup dialog |
| `GET /api/dsh-reckoner/list-roots`, `GET /api/dsh-reckoner/list-dirs` | the output-directory browser |
| `GET /api/dsh-reckoner/directory-tree.css` | the vendored stylesheet the panel injects |
| `GET` / `PUT /api/dsh-reckoner/settings` | the whole settings view; `PUT` writes only the sections its body names and answers `{saved, settings}`, `400 {error}` for an unusable body, `405` for another method |
| `POST /api/dsh-reckoner/reveal` | opens a generated file or its folder in the host's file manager |

## 12. The outside lookup

### 12.1 Basics

The pure `reckoner` preset reaches nothing: it has six tools, no shell, no file system and no network. One outside fact at a time arrives through the `reckoner-with-search` preset, which carries one row more and nothing else. That row, `dsh-reckoner/search`, registers the `search` tool for the session and forwards every call to the host half of the plugin through the `reckonerSearch` service; the row alone registers nothing else, so a session without it has no `search` tool at all. The generic `web_search` and `web_fetch` tools are mounted by neither preset, so the model can never search or fetch on its own. The engine plays no part in the retrieval: it validates the fact and appends the row, exactly as it does for `set`.

### 12.2 Configurations

| key | code default | meaning |
|---|---|---|
| `tier` | `strict` | `strict` keeps only allow-listed hosts; `open` keeps every source |
| `allowedHosts` | the 12 reference hosts | host suffixes a strict lookup accepts, matched as the pattern or a subdomain, never as a mere suffix of letters |
| `maxResults` | `12` | upper bound on the sources one provider call returns |
| `maxSearchesPerRecord` | `4` | how many lookups one record may carry |
| `answerMaxChars` | `1200` | upper bound on the answer handed to the model |
| `enrich.pages` | `0` | allowed pages fetched for their text; `0` keeps the citation snippets |
| `enrich.charsPerPage` | `4000` | text of each fetched page that reaches the extractive step |
| `synthesis.provider`, `synthesis.model` | unset | the route of the extractive step; unset means the deployment default |
| `synthesis.maxTokens` | `800` | the token ceiling of the extractive call |

An explicitly empty `allowedHosts` is a decision: a strict lookup then answers nothing. Only the answer the model receives, and its copy in the synthesis, are cut to `answerMaxChars`.

The default allow-list is reference material a calculation may cite: `wikipedia.org`, `github.com`, `githubusercontent.com`, `stackoverflow.com`, `stackexchange.com`, `developer.mozilla.org`, `docs.python.org`, `nist.gov`, `iso.org`, `ietf.org`, `rfc-editor.org` and `arxiv.org`.

### 12.3 Failure codes
| code | raised when |
|---|---|
| `SEARCH_INSUFFICIENT` | no source the policy allowed holds the fact, or the extractive step answered `insufficient` |
| `SEARCH_BUDGET_EXCEEDED` | the record has spent its `maxSearchesPerRecord` lookups. The call never reaches the provider |
| `SEARCH_UNAVAILABLE` | the provider, the network, the extractive model or a required service failed, or no default model is configured |
| `ENGINE_OPEN_RECORD_NOT_FOUND` | no record is open. A lookup is recorded, so it requires an open record |
