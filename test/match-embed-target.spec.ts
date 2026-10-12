/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        matchEmbedTarget tests
 * CVM-Role:        Test
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Tests the structural-include matcher shared by the writer
 *                  index and the editor's inline include previews.
 *
 * END HEADER
 */

import { strictEqual } from 'assert'
import { matchEmbedTarget } from 'source/common/util/match-embed-target'

describe('Utility#matchEmbedTarget()', function () {
  it('accepts the canonical and the other documented forms', function () {
    strictEqual(matchEmbedTarget('![](notes/01-intro.md)'), 'notes/01-intro.md')
    strictEqual(matchEmbedTarget('![alt text](notes/01-intro.md)'), 'notes/01-intro.md')
    strictEqual(matchEmbedTarget('![](notes/01-intro.md "title")'), 'notes/01-intro.md')
    strictEqual(matchEmbedTarget('![](<notes/with spaces.md>)'), 'notes/with spaces.md')
    strictEqual(matchEmbedTarget('![](notes/01-intro)'), 'notes/01-intro')
    strictEqual(matchEmbedTarget('![[01-intro|Title]]'), '01-intro')
    strictEqual(matchEmbedTarget('![[01-intro#heading]]'), '01-intro')
    strictEqual(matchEmbedTarget('![](2026_10_12-085543~T~p2~Z.md)'), '2026_10_12-085543~T~p2~Z.md')
  })

  it('rejects non-structural embeds', function () {
    strictEqual(matchEmbedTarget('[Chapter 1](notes/01-intro.md)'), undefined)
    strictEqual(matchEmbedTarget('![](diagram.png)'), undefined)
    strictEqual(matchEmbedTarget('Text before ![](notes/x.md)'), undefined)
    strictEqual(matchEmbedTarget('- ![](notes/x.md)'), undefined)
    strictEqual(matchEmbedTarget('> ![](notes/x.md)'), undefined)
    strictEqual(matchEmbedTarget('![](notes/a.md)\n![](notes/b.md)'), undefined)
  })
})
