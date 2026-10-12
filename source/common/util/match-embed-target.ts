/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        matchEmbedTarget
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Recognizes a structural-include line (an embed alone on
 *                  its line targeting a Markdown file) and extracts its raw
 *                  target. Shared by the writer index (main) and the editor's
 *                  inline include previews (renderer), so it must not depend
 *                  on Node's `path` module.
 *
 * END HEADER
 */

import { WRITER_INDEX_EXT } from './writer-index-ext'

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
 * Equivalent of Node's `path.extname` for both separators.
 */
function extname (target: string): string {
  const base = target.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot) : ''
}

/**
 * If the given source is exactly one structural-include line (an embed alone
 * on its line targeting a Markdown file), returns the raw target — else
 * undefined.
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
  const ext = extname(target)
  if (ext !== '' && !WRITER_INDEX_EXT.includes(ext.toLowerCase())) {
    return undefined
  }

  return target
}
