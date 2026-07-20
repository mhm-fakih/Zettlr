/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        buildManuscriptTree
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Builds a manuscript tree from writer index entries: one
 *                  tree interleaving a file's headings and its structural
 *                  includes in document order. Included files nest under the
 *                  heading section they appear in. Cycles and includes beyond
 *                  the depth cap become error nodes instead of recursing.
 *
 * END HEADER
 */

import path from 'path'
import type { ManuscriptTreeNode, WriterFileEntry } from '@dts/common/writer'

/**
 * Includes nested deeper than this many file levels are not resolved
 * (spec §2: depth cap 8)
 */
export const MAX_INCLUDE_DEPTH = 8

/**
 * Resolves a raw include target relative to its source file. Returns either
 * the resolved absolute path or an error state.
 */
export type IncludeResolver = (sourcePath: string, target: string) => { path?: string, error?: 'missing'|'ambiguous' }

/**
 * Builds the manuscript tree for the given root file.
 *
 * @param   {string}                        rootPath  The root file
 * @param   {Map<string, WriterFileEntry>}  entries   The writer index
 * @param   {IncludeResolver}               resolve   Resolver for include targets
 *
 * @return  {ManuscriptTreeNode|null}                 The tree, or null if the
 *                                                    root is not indexed
 */
export function buildManuscriptTree (
  rootPath: string,
  entries: Map<string, WriterFileEntry>,
  resolve: IncludeResolver
): ManuscriptTreeNode|null {
  if (!entries.has(rootPath)) {
    return null
  }

  return buildFileNode(rootPath, entries, resolve, 0, [])
}

function buildFileNode (
  filePath: string,
  entries: Map<string, WriterFileEntry>,
  resolve: IncludeResolver,
  depth: number,
  ancestry: string[]
): ManuscriptTreeNode {
  const entry = entries.get(filePath)
  const node: ManuscriptTreeNode = {
    type: 'file',
    label: path.basename(filePath),
    path: filePath,
    line: 1,
    words: entry?.words ?? 0,
    children: []
  }

  if (entry === undefined) {
    node.error = 'missing'
    return node
  }

  // Interleave headings and includes in document order. Headings nest by
  // level; includes attach to the innermost open heading section.
  const items = [
    ...entry.headings.map(heading => ({ line: heading.line, heading, include: undefined })),
    ...entry.includes.map(include => ({ line: include.line, heading: undefined, include }))
  ].sort((a, b) => a.line - b.line)

  // The stack of open containers; headings carry their level for nesting
  const stack: ManuscriptTreeNode[] = [node]
  let includedWords = 0

  for (const item of items) {
    if (item.heading !== undefined) {
      const { level, text, line, words } = item.heading
      while (stack.length > 1 && (stack[stack.length - 1].level ?? 0) >= level) {
        stack.pop()
      }

      const headingNode: ManuscriptTreeNode = {
        type: 'heading',
        label: text,
        path: filePath,
        line,
        level,
        words,
        children: []
      }
      stack[stack.length - 1].children.push(headingNode)
      stack.push(headingNode)
    } else if (item.include !== undefined) {
      const { target, line } = item.include
      let child: ManuscriptTreeNode

      const resolved = resolve(filePath, target)
      if (resolved.error !== undefined || resolved.path === undefined) {
        child = {
          type: 'file',
          label: target,
          path: '',
          line,
          words: 0,
          error: resolved.error ?? 'missing',
          children: []
        }
      } else if (resolved.path === filePath || ancestry.includes(resolved.path)) {
        child = {
          type: 'file',
          label: path.basename(resolved.path),
          path: resolved.path,
          line,
          words: 0,
          error: 'cycle',
          children: []
        }
      } else if (depth + 1 >= MAX_INCLUDE_DEPTH) {
        child = {
          type: 'file',
          label: path.basename(resolved.path),
          path: resolved.path,
          line,
          words: 0,
          error: 'depth',
          children: []
        }
      } else {
        child = buildFileNode(resolved.path, entries, resolve, depth + 1, [ ...ancestry, filePath ])
        includedWords += child.words
        // The enclosing heading sections also contain the transcluded words
        for (const container of stack.slice(1)) {
          container.words += child.words
        }
      }

      stack[stack.length - 1].children.push(child)
    }
  }

  // A file's badge counts its own words plus everything it transcludes
  node.words = entry.words + includedWords
  return node
}
