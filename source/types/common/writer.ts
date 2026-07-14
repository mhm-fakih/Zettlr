/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Writer types
 * CVM-Role:        Types
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Shared types for the writer index provider (manuscript
 *                  trees built from structural includes, heading outlines,
 *                  and the TODO index).
 *
 * END HEADER
 */

/**
 * A single heading within a Markdown file
 */
export interface WriterHeading {
  /**
   * Heading level, 1-6
   */
  level: number
  /**
   * The heading text (plain string, without formatting)
   */
  text: string
  /**
   * The 1-indexed line the heading is on
   */
  line: number
  /**
   * Words in this heading's section, i.e. up to the next heading of the same
   * or a higher level (including nested subsections)
   */
  words: number
}

/**
 * A structural include (an embed alone on its line at the top level whose
 * target is a Markdown file), as written in the source. Targets are stored
 * raw and resolved on demand, so file renames don't require a re-parse.
 */
export interface WriterInclude {
  /**
   * The raw include target as written (path or wikilink name)
   */
  target: string
  /**
   * The 1-indexed line of the embed
   */
  line: number
}

/**
 * A TODO-style annotation found in a Markdown file
 */
export interface WriterTodo {
  /**
   * The tag, e.g. 'TODO' or 'FIXME'
   */
  tag: string
  /**
   * The message following the tag (rest of the line)
   */
  message: string
  /**
   * The 1-indexed line of the annotation
   */
  line: number
}

/**
 * Everything the writer index knows about one Markdown file
 */
export interface WriterFileEntry {
  /**
   * Absolute path of the file
   */
  path: string
  /**
   * The file's basename
   */
  name: string
  /**
   * Word count of the file itself (not counting included files)
   */
  words: number
  /**
   * All headings, in document order
   */
  headings: WriterHeading[]
  /**
   * All structural includes, in document order
   */
  includes: WriterInclude[]
  /**
   * All TODO annotations, in document order
   */
  todos: WriterTodo[]
}

/**
 * Why a tree node is in an error state
 */
export type ManuscriptNodeError = 'missing'|'ambiguous'|'cycle'|'depth'

/**
 * One node in a manuscript tree: either an (included) file or a heading
 * within one. File and heading nodes form a single tree.
 */
export interface ManuscriptTreeNode {
  type: 'file'|'heading'
  /**
   * Display label: the file's basename, or the heading text
   */
  label: string
  /**
   * Absolute path of the file this node belongs to (empty for unresolvable
   * include targets)
   */
  path: string
  /**
   * The 1-indexed line to jump to when the node is clicked (1 for files)
   */
  line: number
  /**
   * Heading level (heading nodes only)
   */
  level?: number
  /**
   * Word count: for heading nodes the section's words; for file nodes the
   * file's words plus those of all included descendants
   */
  words: number
  /**
   * Set if this node could not be resolved (see ManuscriptNodeError)
   */
  error?: ManuscriptNodeError
  children: ManuscriptTreeNode[]
}

/**
 * A potential manuscript root: a file containing at least one structural
 * include
 */
export interface WriterRoot {
  path: string
  name: string
}
