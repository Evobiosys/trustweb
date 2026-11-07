// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37: the app's one-ring mark of the logo family (src/brand/mark_one_current.svg) as inline markup for the header,
 * in the text colour, hidden from assistive tech (the title beside it names the screen).
 */
import raw from './brand/mark_one_current.svg?raw'

export const BRAND_MARK_SVG = raw
  .replace(/<!--.*?-->\s*/s, '')
  .replace(' role="img" aria-label="trustweb.one mark"', ' aria-hidden="true"')
  .trim()
