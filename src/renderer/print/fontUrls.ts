// Phase 33 - bundler-resolved URLs for the bundled print fonts (resources/fonts), keyed by file name, for the dev
// preview iframe. Real print / PDF / image (Phases 37-39) load the same files by file:// URL from main instead.
import latin400 from '../../../resources/fonts/noto-sans-latin-400-normal.woff2?url'
import latinExt400 from '../../../resources/fonts/noto-sans-latin-ext-400-normal.woff2?url'
import latin700 from '../../../resources/fonts/noto-sans-latin-700-normal.woff2?url'
import latinExt700 from '../../../resources/fonts/noto-sans-latin-ext-700-normal.woff2?url'

export const PRINT_FONT_URLS: Readonly<Record<string, string>> = {
  'noto-sans-latin-400-normal.woff2': latin400,
  'noto-sans-latin-ext-400-normal.woff2': latinExt400,
  'noto-sans-latin-700-normal.woff2': latin700,
  'noto-sans-latin-ext-700-normal.woff2': latinExt700
}
