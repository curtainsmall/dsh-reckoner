/**
 * ElectroLab record → LaTeX article renderer.
 *
 * Same narrative as the Markdown renderer (article-core.ts walks the trace):
 * a titled solution document whose problem quote, step-by-step analysis and
 * calculation sections, named-condition handover and conclusion become LaTeX
 * source. Output is pure ASCII — unit glyphs (Ω, µ, °, ∠, −) are emitted as
 * math commands, and user texts are escaped, so the document compiles with
 * plain pdfLaTeX.
 */
import { narrativeOf, isScalarValue, innerOf, humanOf, type ArticleSource, type NamedValue } from './article-core.ts'

export type { ArticleSource } from './article-core.ts'

const DOC = {
  preamble: [
    '\\documentclass[11pt]{article}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage{amsmath}',
    '',
    '\\title{\\textbf{DeepSeek Harness ElectroLab Solution}}',
    '\\author{DeepSeek Harness ElectroLab}',
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
  ],
  problem: '\\section*{Problem}',
  solution: '\\section*{Solution}',
  conclusion: '\\section*{Conclusion}',
  end: ['\\end{document}'],
}

/** Escape LaTeX special characters; run BEFORE injecting math commands for the unit glyphs. */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}_$&%#^~])/g, '\\$1')
}

/** Replace the unit glyphs produced by displayValue with ASCII-safe math. */
function glyphsToMath(text: string): string {
  return text
    .replace(/Ω/g, '$\\Omega$')
    .replace(/µ/g, '$\\mu$')
    .replace(/°C/g, '${}^{\\circ}$C')
    .replace(/°/g, '${}^{\\circ}$')
    .replace(/∠/g, '$\\angle$')
    .replace(/−/g, '$-$')
    .replace(/·/g, '-')
}

/** Safe plain text: escaped then glyphs → math (order matters: escape first). */
function texText(text: string): string {
  return glyphsToMath(escapeLatex(text))
}

/** Monospace identifier (slot/solver names). */
function texId(name: string): string {
  return `\\texttt{${escapeLatex(name)}}`
}

/** Inline scalar value; structured values contribute only their name (they get a verbatim block). */
function texValue(value: unknown): string {
  return texText(humanOf(value))
}

/** Render one value: scalar inline, structured JSON payload as a verbatim block. */
function texValueBlock(value: unknown): string {
  if (isScalarValue(value)) return texValue(value)
  return '\\begin{verbatim}\n' + JSON.stringify(innerOf(value), null, 2) + '\n\\end{verbatim}'
}

/** Build the LaTeX article source from a record body. */
export function buildLatexArticle(body: ArticleSource): string {
  const { question, blocks } = narrativeOf(body)
  const sections: string[] = []
  let step = 0

  const premiseLine = (premise: NamedValue): string | undefined => {
    if (!isScalarValue(premise.value)) return undefined
    return `\\emph{given ${texId(premise.name)} = ${texValue(premise.value)}}`
  }

  for (const block of blocks) {
    if (block.kind === 'analysis') {
      step += 1
      const parts: string[] = [`\\subsection*{Step ${step} -- Analysis}`]
      const premise = block.premise === undefined ? undefined : premiseLine(block.premise)
      if (premise !== undefined) parts.push(premise)
      parts.push(texText(block.text))
      sections.push(parts.join('\n\n'))
    } else if (block.kind === 'given') {
      step += 1
      sections.push(`\\subsection*{Step ${step} -- Given: ${texId(block.name)}}\n\n${texId(block.name)} = ${texValueBlock(block.value)}`)
    } else if (block.kind === 'drop') {
      sections.push(`\\emph{The condition ${texId(block.name)} is dropped from this point on.}`)
    } else if (block.kind === 'calculation') {
      step += 1
      const parts: string[] = [`\\subsection*{Step ${step} -- ${texId(block.solver)}}`]
      if (block.inputs.length > 0) {
        parts.push('\\textbf{Inputs:}\n\\begin{itemize}\n' +
          block.inputs.map(([name, value]) => `  \\item ${texId(name)}: ${texValueBlock(value)}`).join('\n') +
          '\n\\end{itemize}')
      }
      if (block.target !== undefined && block.result !== undefined) {
        parts.push(`\\textbf{Result:} ${texId(block.target)} = ${texValueBlock(block.result)}`)
      } else {
        parts.push('\\textbf{Result:} --- completed, no target slot')
      }
      sections.push(parts.join('\n\n'))
    } else {
      sections.push(`${DOC.conclusion}\n\n${texText(block.text)}`)
    }
  }

  const out = [
    ...DOC.preamble,
    '',
    DOC.problem,
    '',
    texText(question),
    '',
    DOC.solution,
    '',
    ...sections,
    ...DOC.end,
  ]
  return out.join('\n') + '\n'
}
