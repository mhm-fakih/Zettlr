/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        isWriterIndexable
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Decides which files the writer index (manuscript tree,
 *                  TODO and codes panels) reads. NOTE: This is deliberately
 *                  narrower than Zettlr's MD_EXT, which also counts .txt as
 *                  Markdown -- workspaces tend to contain .txt data dumps and
 *                  logs that are not notes.
 *
 * END HEADER
 */

import path from 'path'

/**
 * The extensions the writer index treats as manuscript notes
 */
export const WRITER_INDEX_EXT = [ '.md', '.markdown', '.mkd', '.mdx', '.rmd', '.qmd' ]

/**
 * Whether the given file should be read by the writer index.
 *
 * @param   {string}   filePath  The file's path
 *
 * @return  {boolean}            True if the file is a manuscript note
 */
export function isWriterIndexable (filePath: string): boolean {
  return WRITER_INDEX_EXT.includes(path.extname(filePath).toLowerCase())
}
