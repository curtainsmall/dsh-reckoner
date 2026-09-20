---
name: reckoner-template
description: "Reckoner record protocol: record_question opens a record (question verbatim), record_analyse submits the analysis, record_answer submits the answer and seals — the structured content lives in the record, so the chat answer stays natural (no template headings in the session)"
whenToUse: "An reckoner workflow is triggered: the answer reports results obtained through the engine (any set/get/eval or marker appears in it). In the reckoner preset the persona embeds the same protocol"
---

# DeepSeek Harness Reckoner Record Protocol

The structured content (question, analysis, formula steps, results, answer) is captured by the RECORD, not by the session chat. Answer the user naturally; the record markers carry the structure.

## Record protocol (bracketing)

A record is bracketed by the marker tools — only what happens between them is recorded:

- Call `record_question` FIRST, before any other tool, passing the consolidated question (verbatim) as `text` — merge every user input, including follow-ups, into one full question that needs no further context.
- Store the conditions: call `set` for each quantity the user gave, as value strings (see the value grammar in the reckoner-interface skill). This is transcription of the user's wording, not calculation.
- Call `record_analyse` BEFORE the first `eval`, passing the analysis as `text`. It holds the BASIC IDEA of solving only: the knowns with their units (as stored in the slots), the target quantity, and the approach with the relations you will use. No computed numbers, no calculation outputs, no verification talk — every calculated value belongs in the answer.
- Call `record_answer` LAST, after the `eval` steps, passing the final answer as `text` — it seals the record immediately. Reason only from the receipts and `get` results; this is where all numbers go.

The submitted texts contain the CONTENT ONLY — no labels or headings such as `问题（Question）` or `分析（Analysis）`, no tables: the record renders the structure itself.

A second `record_question` while a record is open seals the open one as a duplicate-start error record and starts a new one; `record_answer` with no open record keeps a duplicate-end error record. Call each marker exactly once per answer.

## Operational details

Values, the `$` notation, the dimension rules and the set/get/eval discipline live in the reckoner-interface skill — follow it alongside this template.

## Discipline

- Gate first: before any tool call, check that every quantity the computation needs was actually given by the user. If anything is missing, stop: no tool calls, no markers — state exactly what is missing and which relation therefore cannot be evaluated (see the reckoner-interface skill).
- Never convert units, prefixes or complex notation yourself and never do arithmetic by hand: conditions are stored as value strings via `set`, and every derived number comes from a slot an `eval` wrote.
- The chat answer is natural language: no template tables or numbered headings in the session — the record is the structured presentation.

## Article writing voice

When a full article (Markdown or LaTeX) is generated from a record — by the host generation buttons or by you, if asked to write one — present the work as if you had carried out the calculation yourself:

- Do NOT mention Reckoner, DeepSeek Harness, the harness, formulas, derivation steps, records, tool calls, markers, or the generation process anywhere in the body text.
- No meta commentary, no system references, no "the engine computed…" phrasing — only the problem, the approach, the calculations and the result, written as your own solution.
- The only allowed occurrences of the product name are the document frame: the fixed title `DeepSeek Harness Reckoner Solution` and the author line `DeepSeek Harness Reckoner` (both are supplied by the document shell/title requirements, never by the body).
