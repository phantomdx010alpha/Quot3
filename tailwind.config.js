/** @type {import('tailwindcss').Config} */
// Tailwind is for layout utilities. Colours/shadows/radii come from CSS tokens (tokens.css) —
// the aliases below let utilities reference them without hardcoding any value.
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--surface-base)',
        raised: 'var(--surface-raised)',
        inset: 'var(--surface-inset)',
        accent: 'var(--accent)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)'
      }
    }
  },
  plugins: []
}
