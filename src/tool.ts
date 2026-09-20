/**
 * The tool core: `defineJsonTool`, the factory every tool is built with
 * (the engine primitives set/get/eval and the record markers).
 *
 * A tool's output is an unconstrained JSON value rendered as pretty text for
 * the model. ToolError/ToolErrorCode are re-exported so callers import the
 * failure types from one place.
 */
import { defineTool, type DefineToolOptions, type InferArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { QUANTITY_KIND_NAMES } from './math/quantity-kind.ts'
import { ToolError, ToolErrorCode } from './errors.ts'

/** Re-exported so every caller imports the failure types from one place. */
export { ToolError, ToolErrorCode }

/** Re-exported for callers that only need the kind list (the pure source is math/quantity-kind). */
export { QUANTITY_KIND_NAMES }

/** Pretty JSON text rendering for the model-facing presentation. */
export function renderText(value: JsonValue): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * Define a tool whose output is an unconstrained JSON value rendered as
 * pretty text. `execute` may be synchronous; it is wrapped into the async
 * contract the registry expects. The execution context is passed through
 * so orchestrator tools can propagate cancellation and parent tokens.
 */
export function defineJsonTool<S extends ParameterSchemaSpec>(
  options: Omit<DefineToolOptions<S, { type: 'json' }>, 'output' | 'execute'> & {
    execute: (args: InferArgs<S>, exec: ToolRunContext) => JsonValue | Promise<JsonValue>
  },
) {
  return defineTool({
    ...options,
    execute: async (args, exec) => {
      // One unified failure path at the tool boundary: every failure inside
      // TypeScript is a throw — lower layers throw whatever they want, and any
      // non-ToolError is re-wrapped here so every tool call fails through the
      // same structured channel.
      try {
        return await options.execute(args, exec)
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new ToolError(error instanceof Error ? error.message : String(error))
      }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderText(value as JsonValue),
    },
  })
}
