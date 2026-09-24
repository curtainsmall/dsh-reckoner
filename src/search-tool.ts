/**
 * The `search` row: the one tool the `reckoner-with-search` preset adds.
 *
 * The row is deliberately thin. It carries the policy (config), registers the
 * model-facing tool, and forwards to the host half, which owns the retrieval,
 * the extractive call and the record. Two consequences matter:
 *
 * - the tool exists only where this row is mounted, so the pure `reckoner`
 *   preset keeps its six-tool surface, and no session ever gets the generic
 *   `web_search` / `web_fetch` tools;
 * - the model receives the answer alone. The queries, the candidate sources and
 *   the sources the answer relied on go into the record, which is the reader's
 *   account of where the number came from.
 */
import type { Context } from 'cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { defineJsonTool } from './tool.ts'
import { resolveSearchConfig } from './search/config.ts'
import type { LookupReceipt } from './search/lookup.ts'
import type { ReckonerSearchService } from './search/service.ts'
import { TraceTool } from './engine/trace-tools.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-reckoner-search'

/** The tool registry is the only service this row needs; the host half arrives through `reckonerSearch`. */
export const inject = ['tools']

/** The model-facing description: what the tool is for, and the four rules that keep it an input. */
export const SEARCH_DESCRIPTION =
  'Look one fact up outside this calculation and get back a plain answer. Ask it the question as you would ask a ' +
  'colleague - "thermal conductivity of copper at 300 K" - and you receive a short answer in words, already ' +
  'extracted from the sources; the pages, the queries and the sources themselves are not shown to you, they go ' +
  'into the record. Four rules: (1) the answer is an INPUT, never a result - store the number yourself with set, ' +
  'copying it with the unit exactly as the answer writes it, and let the engine convert; (2) never ask it to ' +
  'compute, convert, round or derive anything; (3) never ask it for something the record already holds; (4) if it ' +
  'answers that no allowed source holds the fact, that quantity is missing - say which relation cannot be ' +
  'evaluated and stop. A record allows only a few lookups, and every one of them is written into it with its sources.'

/**
 * Guard for the published service: an absent host half is a receipt, never a
 * throw. The process id is in the sentence because the two halves can be mounted
 * in different hosts or different builds - this row alone cannot serve a lookup,
 * and the reader needs to know which host to look at.
 */
function unavailable(): LookupReceipt {
  return {
    ok: false,
    code: 'SEARCH_UNAVAILABLE',
    error:
      `the host half of dsh-reckoner is not mounted in this host (pid ${process.pid}), so no lookup can run: ` +
      'the plugin row is missing or failed to mount here. Restart the host and check its log for the row.',
  }
}

/**
 * Mount the row: resolve the policy once and register the tool.
 * @param ctx - the row's context, carrying the tool registry.
 * @param config - the raw config of this row in the preset.
 */
export function apply(ctx: Context, config?: unknown): void {
  const { config: policy, problems } = resolveSearchConfig(config)
  for (const problem of problems) {
    ctx.logger?.warn?.(`dsh-reckoner search: ${problem}`)
  }
  const tool = defineJsonTool({
    name: TraceTool.Search,
    description: SEARCH_DESCRIPTION,
    // Declaring a budget asserts the tool forwards exec.signal to every call it makes.
    timeoutMs: 120_000,
    parameters: {
      question: {
        type: 'string',
        description: 'the fact you need, asked as a question in one sentence',
        required: true,
      },
    },
    execute: async (args, exec) => {
      const service = ctx.get('reckonerSearch') as ReckonerSearchService | undefined
      if (service === undefined) return unavailable() as unknown as JsonValue
      const question = typeof args.question === 'string' ? args.question : ''
      const receipt = await service.lookup(
        { question, ...(exec.signal === undefined ? {} : { signal: exec.signal }) },
        policy,
      )
      return receipt as unknown as JsonValue
    },
  })
  ctx.effect(() => ctx.tools.register(tool), 'dsh-reckoner-search: search tool')
}
