/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        scanLdlCodes
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Scans text for standalone letter-digit-letter codes
 *                  (e.g. T3Z). Shared between the writer index (codes panel)
 *                  and the editor's highlighter so both always agree.
 *
 * END HEADER
 */

import type { WriterCode } from '@dts/common/writer'

/**
 * A standalone letter-digit-letter token, e.g. T3Z. The lookarounds ensure it
 * is not part of a longer alphanumeric run (e.g. aT3Zb or T3Z9).
 */
export const LDL_CODE_RE = /(?<![\p{L}\p{Nd}])\p{L}\p{Nd}\p{L}(?![\p{L}\p{Nd}])/gu

/**
 * Scans the given text for standalone letter-digit-letter codes.
 *
 * @param   {string}        content  The text to scan
 *
 * @return  {WriterCode[]}           All found codes, in document order
 */
export function scanLdlCodes (content: string): WriterCode[] {
  const codes: WriterCode[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(LDL_CODE_RE)) {
      codes.push({ code: match[0], line: i + 1 })
    }
  }

  return codes
}
