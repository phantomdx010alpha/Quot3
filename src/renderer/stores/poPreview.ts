/**
 * Phase 154: the PO number the Create page last SHOWED as "next PO" for a new bill. It is only a preview (the real number is taken
 * inside the save transaction in the main process), so when another window saves first the saved number differs and the save
 * notice says so. Plain module state (no store, no subscription): it is read once, on save.
 */
let shown = ''
export function setShownPoPreview(po: string): void { shown = po }
export function takeShownPoPreview(): string { const p = shown; shown = ''; return p }
