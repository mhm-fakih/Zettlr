/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        assembleManuscript
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Assembles a manuscript for export (spec §5): resolves the
 *                  structural includes of a master file depth-first and
 *                  splices the included files' contents in order. Included
 *                  files lose their frontmatter, their headings shift by
 *                  nesting depth (optional, default on), and TODO lines are
 *                  stripped (optional, default on). The result is one
 *                  Markdown document for Zettlr's regular Pandoc pipeline.
 *
 * END HEADER
 */

import path from 'path'
import { scanTodos, DEFAULT_TODO_TAGS } from '@common/util/scan-todos'
import { matchEmbedTarget } from './parse-writer-file'
import { MAX_INCLUDE_DEPTH, type IncludeResolver } from './build-manuscript-tree'

/**
 * A DB-sync field marker line, e.g. `@@ summary @@` (see docs/MASTER-TOC-FORMAT.md)
 */
export const FIELD_MARKER_RE = /^@@\s*[^@\n]+?\s*@@\s*$/

export interface AssembleManuscriptOptions {
  /**
   * Shift ATX heading levels of included files by their nesting depth
   * (spec §5.2; default true)
   */
  shiftHeadings: boolean
  /**
   * Remove lines carrying a TODO annotation (spec §5.3; default true)
   */
  stripTodos: boolean
  /**
   * The TODO tags to strip
   */
  todoTags?: string[]
  /**
   * Remove `@@ field @@` DB-sync marker lines (each note section under such a
   * marker maps to a database field; the markers themselves are metadata and
   * don't belong in an export). Default true.
   */
  stripFieldMarkers?: boolean
  /**
   * If set, injected as `zettlr.pandoc_working_dir` into the root's
   * frontmatter so that relative resource paths (images) keep working even
   * though the assembled file lives in a temporary directory.
   */
  pandocWorkingDir?: string
}

/**
 * Removes a YAML frontmatter block from the given lines, if present.
 */
function stripFrontmatter (lines: string[]): string[] {
  if (lines.length < 2 || lines[0] !== '---') {
    return lines
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      return lines.slice(i + 1)
    }
  }

  return lines // Unterminated: not actually a frontmatter
}

/**
 * Injects `zettlr.pandoc_working_dir` into the (root) document's frontmatter,
 * creating one if necessary. Documents that already configure a `zettlr:` key
 * are left untouched.
 */
function injectWorkingDir (content: string, workingDir: string): string {
  const lines = content.split('\n')
  const injection = [ 'zettlr:', `  pandoc_working_dir: "${workingDir}"` ]

  if (lines.length >= 2 && lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^zettlr\s*:/.test(lines[i])) {
        return content // The author configures this themselves
      }
      if (lines[i] === '---' || lines[i] === '...') {
        lines.splice(i, 0, ...injection)
        return lines.join('\n')
      }
    }
    return content // Unterminated frontmatter
  }

  return [ '---', ...injection, '---', '' ].join('\n') + content
}

/**
 * Assembles the manuscript rooted at the given master file into a single
 * Markdown string.
 *
 * @param   {string}                     rootPath  The master file
 * @param   {Function}                   readFile  Returns a file's contents
 * @param   {IncludeResolver}            resolve   Resolves include targets
 * @param   {AssembleManuscriptOptions}  options   Assembly options
 *
 * @return  {Promise<string>}                      The assembled Markdown
 */
export async function assembleManuscript (
  rootPath: string,
  readFile: (absPath: string) => Promise<string>,
  resolve: IncludeResolver,
  options: AssembleManuscriptOptions
): Promise<string> {
  let assembled = await assembleFile(rootPath, 0, [], readFile, resolve, options)

  if (options.pandocWorkingDir !== undefined) {
    assembled = injectWorkingDir(assembled, options.pandocWorkingDir)
  }

  return assembled
}

async function assembleFile (
  filePath: string,
  depth: number,
  ancestry: string[],
  readFile: (absPath: string) => Promise<string>,
  resolve: IncludeResolver,
  options: AssembleManuscriptOptions
): Promise<string> {
  let content = await readFile(filePath)

  // Only the root document keeps its frontmatter: Pandoc must see exactly one
  let lines = content.split('\n')
  if (depth > 0) {
    lines = stripFrontmatter(lines)
    content = lines.join('\n')
  }

  // scanTodos already skips fenced code and the frontmatter, so its line
  // numbers are exactly the lines to drop
  const todoLines = options.stripTodos
    ? new Set(scanTodos(content, options.todoTags ?? DEFAULT_TODO_TAGS).map(todo => todo.line))
    : new Set<number>()

  const out: string[] = []
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    if (todoLines.has(i + 1)) {
      continue // Spec §5.3: TODO lines are stripped
    }

    if (options.stripFieldMarkers !== false && FIELD_MARKER_RE.test(line)) {
      continue // DB-sync field markers are metadata, not manuscript text
    }

    const target = matchEmbedTarget(line)
    if (target !== undefined) {
      const resolved = resolve(filePath, target)
      if (resolved.error !== undefined || resolved.path === undefined) {
        out.push(`<!-- writer-export: unresolved include "${target}" (${resolved.error ?? 'missing'}) -->`)
      } else if (resolved.path === filePath || ancestry.includes(resolved.path)) {
        out.push(`<!-- writer-export: circular include "${target}" skipped -->`)
      } else if (depth + 1 >= MAX_INCLUDE_DEPTH) {
        out.push(`<!-- writer-export: include "${target}" beyond depth cap (${MAX_INCLUDE_DEPTH}) skipped -->`)
      } else {
        const childContent = await assembleFile(
          resolved.path, depth + 1, [ ...ancestry, filePath ], readFile, resolve, options
        )
        out.push(childContent.trim())
      }
      continue
    }

    // Spec §5.2: headings of included files shift by nesting depth
    if (options.shiftHeadings && depth > 0) {
      const heading = /^(#{1,6})(\s)/.exec(line)
      if (heading !== null) {
        const newLevel = Math.min(6, heading[1].length + depth)
        out.push('#'.repeat(newLevel) + line.slice(heading[1].length))
        continue
      }
    }

    out.push(line)
  }

  return out.join('\n')
}

/**
 * Returns the file name the assembled manuscript should be written to for the
 * given root file (same base name, so export artifacts are named after the
 * master document).
 */
export function assembledFileName (rootPath: string): string {
  return path.basename(rootPath)
}
