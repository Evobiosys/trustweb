import { describe, expect, it } from 'vitest'
import { asShadowCss } from '../../src/shadow_css'

const DARK = ':host(:not([data-theme="light"]))'

describe('asShadowCss', () => {
  it('as authored: the dark block, :root and body at a line start', () => {
    const out = asShadowCss(':root{--a:1}\n:root:not([data-theme="light"]){--a:2}\nbody{color:red}')
    expect(out).toBe(`:host{--a:1}\n${DARK}{--a:2}\n:host{color:red}`)
  })
  it('minified by the build: no quotes, one line', () => {
    const out = asShadowCss(':root{--a:1}:root:not([data-theme=light]){--a:2}:root:not([data-theme=light]) .tag{x:1}body{color:red}.shell{y:2}')
    expect(out).toBe(`:host{--a:1}${DARK}{--a:2}${DARK} .tag{x:1}:host{color:red}.shell{y:2}`)
  })
  it('a class that merely contains the word body is left alone', () => {
    expect(asShadowCss('.body{a:1} .x body-text{b:2}')).toBe('.body{a:1} .x body-text{b:2}')
  })
})
