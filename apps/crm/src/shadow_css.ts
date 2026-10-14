/**
 * The page stylesheet in a shadow root: :root, html and body become the host element. Written for both forms the stylesheet takes: as
 * authored (quoted attribute values, one rule per line) and as the production build minifies it (quotes dropped, one line). Missing the
 * minified form left the dark variables and the body font out of the person page, so it came up light and serif.
 */
export const asShadowCss = (text: string): string => text
  .replace(/:root:not\(\[data-theme=("?)light\1\]\)/g, ':host(:not([data-theme="light"]))')
  .replace(/:root\b/g, ':host')
  .replace(/(^|[},])(\s*)(?:html|body)(?=\s*[{,])/gm, '$1$2:host')
