/**
 * UI icons — Font Awesome free tier (SVG/JS core, no font files shipped).
 * Per-icon deep imports keep the bundle tiny: the set root exports are not
 * side-effect-free, so importing from it would pull in every icon.
 * Icons by Font Awesome — https://fontawesome.com (CC BY 4.0).
 *
 * Sizing note: react-fontawesome v3 ignores width/height props, so the size
 * is forced through inline style (CSS beats the default 1em sizing).
 */
import { FontAwesomeIcon, type CSSVariables } from '@fortawesome/react-fontawesome'
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons/faChevronLeft'
import { faMarkdown } from '@fortawesome/free-brands-svg-icons/faMarkdown'
import { faSquareRootVariable } from '@fortawesome/free-solid-svg-icons/faSquareRootVariable'

interface IconProps {
  size?: number
}

/** Shared inline sizing: react-fontawesome v3 does not honor width/height props. */
function sized(size: number): React.CSSProperties & CSSVariables {
  return { width: size, height: size, display: 'block', flex: 'none' }
}

/** ‹ back / collapse. */
export function IconChevronLeft({ size = 16 }: IconProps): React.JSX.Element {
  return <FontAwesomeIcon icon={faChevronLeft} style={sized(size)} />
}

/** Markdown brand glyph. */
export function IconMarkdown({ size = 16 }: IconProps): React.JSX.Element {
  return <FontAwesomeIcon icon={faMarkdown} style={sized(size)} />
}

/** √ root glyph used for TeX/LaTeX; optically smaller, so it defaults larger than normal. */
export function IconTex({ size = 18 }: IconProps): React.JSX.Element {
  return <FontAwesomeIcon icon={faSquareRootVariable} style={sized(size)} />
}
