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
import { isWriterIndexable } from '@common/util/is-writer-indexable'
import { scanTodos, DEFAULT_TODO_TAGS } from '@common/util/scan-todos'
import { scanLdlCodes } from '@common/util/scan-codes'
import type { WriterFileEntry, WriterHeading, WriterInclude } from '@dts/common/writer'

// An embed that is the entire (trimmed) source of a top-level paragraph:
// ![alt](target "optional title") respectively ![[target]]
const MD_EMBED_RE = /^!\[[^\]]*\]\(([^)]+)\)$/
const WIKI_EMBED_RE = /^!\[\[([^\]]+)\]\]$/

/**
 * Extracts the actual target from the contents of an inline-link parenthesis,
 * i.e. strips an optional title and angle brackets.
 */
function cleanMdTarget (raw: string): string {
  raw = raw.trim()
  if (raw.startsWith('<')) {
    const end = raw.indexOf('>')
    return end > -1 ? raw.slice(1, end) : raw.slice(1)
  }

  const match = /^(\S+)(?:\s+["'(].*)?$/.exec(raw)
  return match !== null ? match[1] : raw
}

/**
 * Extracts the target from a wikilink embed's contents: strips an optional
 * `|title` segment and a `#heading` anchor.
 */
function cleanWikiTarget (raw: string): string {
  return raw.split('|')[0].split('#')[0].trim()
}

/**
 * If the given source is exactly one structural-include line (an embed alone
 * on its line targeting a Markdown file), returns the raw target — else
 * undefined. Shared between the index parser and the manuscript assembler.
 *
 * @param   {string}            source  One line (or paragraph source)
 *
 * @return  {string|undefined}          The raw include target
 */
export function matchEmbedTarget (source: string): string|undefined {
  source = source.trim()
  if (source.includes('\n')) {
    return undefined
  }

  let target: string|undefined
  const mdMatch = MD_EMBED_RE.exec(source)
  if (mdMatch !== null) {
    target = cleanMdTarget(mdMatch[1])
  } else {
    const wikiMatch = WIKI_EMBED_RE.exec(source)
    if (wikiMatch !== null) {
      target = cleanWikiTarget(wikiMatch[1])
    }
  }

  if (target === undefined || target === '') {
    return undefined
  }

  // Only Markdown targets are structural; targets without extension are
  // resolved like wikilinks (i.e. to Markdown files) later on.
  if (path.extname(target) !== '' && !isWriterIndexable(target)) {
    return undefined
  }

  return target
}

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
