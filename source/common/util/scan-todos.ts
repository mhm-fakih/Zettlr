/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        scanTodos
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Scans Markdown source for TODO-style annotations (spec
 *                  §4). Recognises the tags in prose, list items, and HTML
 *                  comments, but not inside fenced code blocks or the YAML
 *                  frontmatter. Shared between the main-process writer index
 *                  and the editor's TODO gutter — the single scanner the spec
 *                  demands.
 *
 * END HEADER
 */

import type { WriterTodo } from '@dts/common/writer'

/**
 * The default set of harvested TODO tags (spec §4.1)
 */
export const DEFAULT_TODO_TAGS = [ 'TODO', 'FIXME', 'QUESTION', 'SOURCE' ]

/**
 * Scans the given Markdown source for TODO-style annotations.
 *
 * @param   {string}        content  The Markdown source
 * @param   {string[]}      tags     The tags to harvest
 *
 * @return  {WriterTodo[]}           All found annotations, in document order
 */
export function scanTodos (content: string, tags: string[] = DEFAULT_TODO_TAGS): WriterTodo[] {
  if (tags.length === 0) {
    return []
  }

  const todos: WriterTodo[] = []
  const tagRe = new RegExp(`(?:^|[\\s>*+-]|!--)(${tags.join('|')}):\\s*(.*)$`)
  const lines = content.split('\n')

  let inFrontmatter = false
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (i === 0 && line === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (line === '---' || line === '...') {
        inFrontmatter = false
      }
      continue
    }

    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
      continue
    }
    if (inFence) {
      continue
    }

    const match = tagRe.exec(line)
    if (match !== null) {
      let message = match[2].trim()
      if (message.endsWith('-->')) {
        message = message.slice(0, -3).trim()
      }
      todos.push({ tag: match[1], message, line: i + 1 })
    }
  }

  return todos
}
