---
name: reckoner-template
description: The Reckoner record protocol - which marker to call when, and what each submitted text carries.
whenToUse: Load before starting a calculation, so the record is opened, analysed and answered in the right order.
---

# Reckoner record protocol

A record is one question, the conditions it was solved from, the analysis, the evaluation steps and the answer. It is written by three markers in a fixed order; `set`, `get` and `eval` are refused until `record_question` has opened one.

1. `record_question {text}` - FIRST, before any other tool call. `text` is the consolidated question, verbatim: the content only, no heading and no table. Opening a record clears the slot table, so nothing from an earlier question survives. A second `record_question` while a record is open is refused: submit `record_answer` for the open record first.
2. `set` - one call per quantity the user gave, transcribed into SI with its `dim`. This is not a place to calculate: no value enters the record that the user did not give.
3. `record_analyse {text}` - BEFORE the first `eval`. `text` says how the case is solved: the knowns as stored in the slots, the target, and the relations to be used. No computed number belongs here - every calculated value belongs to the answer.
4. `eval` - one expression per call, each writing its own `target`; read a result back with `get` or reference it as `@name` in the next formula.
5. `record_answer {text}` - LAST. `text` is the final answer, verbatim, content only; it seals the record immediately. With no open record it is refused and nothing is written.

Each marker answers `{ok}`; a refused marker answers `{ok: false, code, error}` and changes nothing.

The record is the structured presentation of the work: the chat reply stays prose, without the tables and headings the record already carries.
