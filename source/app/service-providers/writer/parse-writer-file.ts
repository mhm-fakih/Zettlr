/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        parseWriterFile
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Parses a single Markdown file into a WriterFileEntry:
 *                  headings (with per-section word counts), structural
 *                  includes (spec: an embed alone on its line at the top
 *                  level whose target is a Markdown file), and TODO-style
 *                  annotations. Pure function, testable without Electron.
 *
 * END HEADER
 */

import path from 'path'
import { markdownToAST, extractASTNodes } from '@common/modules/markdown-utils'
import type { ASTNode, Heading } from '@common/modules/markdown-utils/markdown-ast'
import { countAll } from '@common/util/counter'
import { scanTodos, DEFAULT_TODO_TAGS } from '@common/util/scan-todos'
import { scanLdlCodes } from '@common/util/scan-codes'
import { matchEmbedTarget } from '@common/util/match-embed-target'
import type { WriterFileEntry, WriterHeading, WriterInclude } from '@dts/common/writer'

// The include matcher is shared with the editor's inline include previews
export { matchEmbedTarget }

/**
 * Parses a Markdown file into its writer index entry.
 *
 * @param   {string}           filePath  Absolute path of the file
 * @param   {string}           content   The file's contents
 * @param   {string}           locale    Locale for word segmentation
 * @param   {string[]}         todoTags  Which TODO tags to harvest
 *
 * @return  {WriterFileEntry}            The parsed entry
 */
export function parseWriterFile (
  filePath: string,
  content: string,
  locale?: string,
  todoTags: string[] = DEFAULT_TODO_TAGS
): WriterFileEntry {
  const ast = markdownToAST(content)

  // Fast line lookup for AST offsets
  const lineStarts: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineStarts.push(i + 1)
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (lineStarts[mid] <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo + 1
  }

  // Headings, with per-section word counts (section = up to the next heading
  // of the same or a higher level)
  const headingNodes = extractASTNodes(ast, 'Heading') as Heading[]
  const headings: WriterHeading[] = headingNodes.map((node, idx) => {
    let sectionEnd = content.length
    for (let j = idx + 1; j < headingNodes.length; j++) {
      if (headingNodes[j].level <= node.level) {
        sectionEnd = headingNodes[j].from
        break
      }
    }

    return {
      level: node.level,
      text: node.content.trim(),
      line: lineOf(node.from),
      words: countAll(ast, locale, node.from, sectionEnd).words
    }
  })

  // Structural includes: any top-level block whose entire source is a single
  // embed line targeting a Markdown file. Embeds nested in lists, quotes, or
  // fenced code never form such a block, so they are excluded naturally.
  const includes: WriterInclude[] = []
  const topLevelChildren: ASTNode[] = ast.type === 'Document' ? ast.children : []
  for (const child of topLevelChildren) {
    const target = matchEmbedTarget(content.slice(child.from, child.to))
    if (target !== undefined) {
      includes.push({ target, line: lineOf(child.from) })
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    words: countAll(ast, locale).words,
    headings,
    includes,
    todos: scanTodos(content, todoTags),
    codes: scanLdlCodes(content)
  }
}
