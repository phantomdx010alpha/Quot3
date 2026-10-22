import type { ClassicLayoutDefinition } from './types'

/** Marks classic as built. It does NOT wrap the old screens: App.tsx's classic branch stays exactly today's JSX (locked by `classicParity.test.ts`). */
export const classicLayout: ClassicLayoutDefinition = { id: 'classic' }
