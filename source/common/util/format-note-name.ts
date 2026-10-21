/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Note filename display formatting
 * CVM-Role:        Utility Function
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Formats note filenames such as `2026_10_21-101556~J~p3~D`
 *                  for display: the dash between date and time becomes three
 *                  (non-breaking, so they do not collapse) spaces, the time
 *                  is shown as HH:mm:ss and the `~` separators become spaces.
 *                  Display only -- the file keeps its name.
 *
 * END HEADER
 */

const DATE_TIME_RE = /^(\d{4}_\d{2}_\d{2})-(\d{2})(\d{2})(\d{2})/

/**
 * Returns the display form of a file or folder name.
 *
 * @param   {string}  name  The name as on disk
 *
 * @return  {string}        The name for display
 */
export default function formatNoteName (name: string): string {
  return name
    .replace(DATE_TIME_RE, '$1\u00A0\u00A0\u00A0$2:$3:$4')
    .replaceAll('~', ' ')
}
