/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Text direction utilities
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Determines the base direction of a document or a piece of
 *                  text. Document direction resolves by precedence: an
 *                  explicit frontmatter `direction:` key, then a frontmatter
 *                  `lang:`/`language:` tag, then the first strong directional
 *                  Unicode character of the given text (title or content) —
 *                  mirroring the HTML dir="auto" algorithm.
 *
 * END HEADER
 */

const RTL_SCRIPT_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u
const LETTER_RE = /\p{Letter}/u

/**
 * Languages written right-to-left (primary subtags)
 */
const RTL_LANGS = [ 'ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ckb', 'dv', 'ug', 'yi' ]

/**
 * Returns the base direction of the given text based on its first strong
 * directional character ('ltr' if none is found).
 *
 * @param   {string}       text  The text to check
 *
 * @return  {'ltr'|'rtl'}        The guessed base direction
 */
export default function guessTextDirection (text: string): 'ltr'|'rtl' {
  for (const char of text) {
    if (RTL_SCRIPT_RE.test(char)) {
      return 'rtl'
    }
    if (LETTER_RE.test(char)) {
      return 'ltr'
    }
  }

  return 'ltr'
}

/**
 * Is the given language tag (e.g. 'ar', 'ar-SA', 'fa_IR') written
 * right-to-left?
 *
 * @param   {string}   lang  The language tag
 *
 * @return  {boolean}        True for RTL languages
 */
export function isRtlLanguage (lang: string): boolean {
  const primary = lang.toLowerCase().split(/[-_]/)[0]
  return RTL_LANGS.includes(primary)
}

/**
 * Resolves a document's base direction: an explicit frontmatter `direction:`
 * wins, then a frontmatter language tag, then the first strong directional
 * character of the provided text (usually the title or first heading).
 *
 * @param   {Record<string, any>|null}  frontmatter   The document's frontmatter
 * @param   {string}                    fallbackText  Text for first-strong-character detection
 *
 * @return  {'ltr'|'rtl'}                             The resolved direction
 */
export function resolveDocumentDirection (frontmatter: Record<string, any>|null|undefined, fallbackText: string): 'ltr'|'rtl' {
  if (frontmatter != null) {
    const direction = frontmatter.direction
    if (direction === 'rtl' || direction === 'ltr') {
      return direction
    }

    const lang = frontmatter.lang ?? frontmatter.language
    if (typeof lang === 'string' && lang.length > 0) {
      return isRtlLanguage(lang) ? 'rtl' : 'ltr'
    }
  }

  return guessTextDirection(fallbackText)
}
