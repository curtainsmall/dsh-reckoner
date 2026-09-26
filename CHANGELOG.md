# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-09-25

A documentation release. The engine, the tools, the record format and the presets are unchanged from `0.1.0`; what changed is how the project explains itself.

### Documentation

- Both READMEs were rewritten in a plainer voice: what the engine is, what the two presets mount, what each tool does, how a record is stored, and what the article writer receives. The install section keeps the one command, and the packaging details it used to explain moved to the manual. The English table of contents is rebuilt so every entry leads to a heading that exists, and a run-on sentence and a spelling mistake in the opening lines are fixed.
- The engine manual was restructured around the order a calculation actually runs in, instead of opening with summary tables. Section 1 is now the state machine itself - no domain knowledge, no built-in solver, numbers that come from slots or from the formula's own literals, and a deterministic result. Section 6.4 is titled "Integer dimension only" and Section 8.2 "Error codes", so a heading says what it constrains rather than what it lists. The panel no longer has a section of its own: its HTTP surface is documented as "Host endpoints", and the outside lookup is the last section, split into basics, configurations and failure codes. Every link between the two manuals resolves again.
- The Chinese manual is regenerated from the English one, so the two carry the same sections, the same tables and the same order, and differ only in language.

## [0.1.0]

The first release: a deterministic calculation engine, six tools, a versioned record and an agent preset that can look one fact up.

### The engine

- One engine runs per host process, and every session's calls act on it. It holds no domain knowledge: no solver, no registry and no named formula. The model writes the formula, and the engine parses it, substitutes the slots, checks the dimensions, evaluates the arithmetic and appends a trace row.
- Dimensions travel with the numbers. Every value carries an SI vector of 7 integer exponents in ISO 80000-1 order (`m, kg, s, A, K, mol, cd`), and evaluation derives the vector of each intermediate: `+` and `-` require one shared vector, `*` and `/` add and subtract them, a real exponent scales one, and a complex exponent needs a dimensionless base.
- A fractional vector is legal while a formula runs - `$sqrt` halves a vector - but only a whole vector may land in a slot, so a square root of a resistance is refused rather than stored.
- The notation class fixes each function's dimensions: `$abs`, `$re`, `$im` and `$conj` keep the vector, `$sqrt` halves it, the transcendental functions and `$floor`/`$ceil`/`$sign` take a dimensionless argument, and `$min`, `$max`, `$mod` and `$atan2` need both arguments on the same vector.
- Nineteen failure codes name the phenomenon rather than the inference. A refusal writes nothing: no slot changes, and the failure row is recorded.

### Values

- A value is a `number`, a `complex` (stored rectangular), an `array` (one SI vector for the whole array) or an `object` (one vector per field). The vector is the value's whole identity; the kind name is a label for readers.
- `set` takes a tagged object with exactly one tag - `num`, `re`/`im`, `mag`/`ang` (converted on entry), `array` or `object` - plus an optional `dim`, which is a table name, 7 integers, or omitted for the zero vector.
- The SI table is the engine's only vocabulary of dimensions: 24 rows of vector, kind label and names, with every name carrying an affine map `SI = x*factor + offset`. `degC` is the only name whose map is not the identity, and it is stored as kelvin.
- The table holds SI names only. Any other unit is converted by the model before the call, so the engine never guesses which unit a number meant.
- `get` takes `form` (`rect` or `polar`, a real widening to a complex), `digits` (significant digits for the display, never padded) and `dim` (a conversion into that spelling, or a check of 7 integers). A `get` receipt can be fed straight back into `set`.

### Formulas and notation

- A formula is one expression: `@name` reads a slot, `@name[index]` an element, `@name.field` a field, and these chain. Operators are `+ - * / ^`; multiplication must be written. There is no comparison, no logic, no conditional and no assignment.
- The `$` notation supplies 5 constants (`$pi`, `$e`, `$inf`, `$i`, `$j`), 20 unary functions, 4 binary functions and 6 bounded forms. `$sum`, `$prod` and `$seq` evaluate; `$integral`, `$limit` and `$diff` can be written but are refused with `ENGINE_UNSUPPORTED_SYMBOL`.
- Arrays are element-wise with a scalar broadcast, and `$seq` builds them - nested `$seq` a row-major two-dimensional one. `$transpose` takes a two-dimensional array, `$len` counts elements and is itself a usable bound.
- A position is the brace written directly after the notation name (`$sum_{k=a}^{b}(body)`), so every other `^` is a power. A bound expression holds no loop variable: `^{N-1}` is an unbound name, `^{@N-1}` a slot.
- A long derivation is several `eval` calls rather than one deep expression: one intermediate per call, read back with `@name`.

### Records

- A record is the process of one calculation: a title, the conditions, the explanations written while working, the evaluation steps and an optional closing text. Three markers carry it - `record_start {title}`, `record_message {text, hide?}` and `record_end {text?}` - and every question gets one.
- The markers are unconditional and the calculation is not: `set` and `eval` carry only the parts that need numbers, and a question that needs none is answered through `record_message`. `set`, `get` and `eval` are refused while no record is open, and closing a record clears the slot table.
- Records are versioned and stored in two tiers. The unclosed record lives in `<home>/open-record.jsonl`; closing renames that file into `<home>/records/<id>.jsonl`, so a closed record is always complete. The first line is `{seq: 0, version: 1}`, and a file without it, or with an older version, is counted as unknown and never listed, served or generated from.
- There is no index file: the list is the directory, and the unclosed record comes from engine state. The trace row is `{seq, at, tool, ok, content}`, and `content` keeps the tool's own fields - the `eval` row holds the formula, the slots it actually read and its result.
- Recovery replays the `set` and `eval` rows of an unclosed record, taking the stored results as facts, so a restart resumes a calculation instead of repeating it.

### The panel

- A **Reckoner** sidebar entry with two tabs. **Records** lists the closed records, pins the unclosed one above them, collapses unreadable files into a single line that offers to delete them, and opens a record as its timeline: one card per step, with the formula, the slots it substituted and the result as a tree.
- **Display all** also reveals the refused rows and the messages marked `hide: true`; the preference is remembered. Selection is marked by the row's border, and a selection can be deleted in one action.
- **Settings** holds the generation defaults of each article format, the search policy as `defaults` / `preset` / `override` / `effective`, and the panel preference - over one endpoint pair, `GET` and `PUT /api/dsh-reckoner/settings`, where a field set to `null` clears that override so the layer below applies again.
- A flat `restartRequired` marker reports a change the running host reads only at its next mount: every mount consumes it, and the Settings tab shows a line while it is set.

### Article generation

- Every closed record can be written up as a standalone article. The writer receives the record's facts in `seq` order - title, conditions, explanations interleaved with the evaluation steps, closing text - with the numbers cut to four decimal places and hidden messages presented as author's notes that must not be printed.
- Markdown is a flat `.md` file; LaTeX is a `.tex` source in a folder named after the file, compiled to PDF when requested. Each format remembers its own directory, language and - LaTeX alone - whether to compile.
- The LaTeX shell, its fonts and its macros are the host's business: the model writes the body, and a body carrying document-restructuring commands, unbalanced braces or an odd number of `$` is refused.
- PDF compilation is delegated to a driver, `latexmk` preferred and MiKTeX's `texify` as the fallback, which runs `xelatex`. The toolchain is checked once per host start, so a request that cannot compile is refused before any model call, and a compile failure is reported without discarding the article.
- Reading the host model stream lives in one module, `src/llm-call.ts`, so the article writer and the search synthesis cannot drift apart on chunk kinds, finish reasons or failure sentences. A generation call that fails reports the provider's own reason rather than a generic one.

### The outside lookup

- An agent preset that can look one fact up: `reckoner-with-search`. It is the pure `reckoner` preset plus exactly one tool, `search`, which takes one question and answers with one short answer in words extracted from the sources.
- The tool is registered by the `dsh-reckoner/search` subpath, which forwards to the host half through the `reckonerSearch` service and never mounts the engine a second time. A session that does not mount that row has no lookup tool at all, and the generic `web_search` and `web_fetch` tools are mounted by neither preset, so the model can never search or fetch on its own.
- The model receives the answer and nothing else - never the queries, the pages or the sources. The record keeps the question, the tier, the outcome, every candidate source the provider returned, the sources the policy allowed, and the route and prompt version of the extractive step.
- Every call writes exactly one `search` row, including the three outcomes that answer nothing, so a lookup that produced nothing is still part of the account. The panel draws a lookup as its own card - the question, the answer it received and a collapsible source list - and shows a refused or unanswered lookup in the warning or error accent.
- The policy is the preset row's config, resolved per call from three layers - the code defaults, the preset row and the user's override - so a settings write reaches the very next lookup, with no host restart and no new session. The strict tier keeps only a host allow-list of reference material, the open tier keeps every source, and a record may carry four lookups by default.
- An article credits the lookups: the question, the answer verbatim and the sources it relied on. A looked-up answer keeps the number as its source wrote it, so the four-decimal cut does not touch it, and an open-tier answer is marked as web-derived and unverified.

### Settings and state

- The state file is a tree: one subtree per module that remembers settings - `generation`, with one entry per article format, `search`, the user's override over the preset row, and `panel` - plus the flat `restartRequired` marker. A writer touches only its own subtree, absence means "use the default", and unknown keys survive verbatim. The file is replaced atomically, and a missing, corrupt or non-object file reads as `{}`.
- The plugin describes itself as a deterministic calculation engine: its sidebar entry uses a pen-ruler glyph, and it carries no electrical-engineering surface.

### Toolchain

- pnpm 11 and Node ≥ 20; CI runs Node 24. TypeScript, tsdown and vitest: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- The package publishes two entry points, the host half and the `dsh-reckoner/search` subpath, and ships two agent presets, the packaged skills and the bundle patch.
- The engine manual exists as `docs/engine.md` and `docs/engine.zh-CN.md`, and the model-facing manual as the packaged `reckoner-interface` and `reckoner-template` skills.
