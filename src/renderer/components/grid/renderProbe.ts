/** Test/dev instrumentation: counts component renders so tests can prove no whole-grid re-renders. Off by default. */
export const renderProbe = {
  enabled: false,
  cells: [] as string[],
  rows: [] as string[],
  footers: 0,
  headers: 0,
  grids: 0,
  reset(): void {
    this.cells = []
    this.rows = []
    this.footers = 0
    this.headers = 0
    this.grids = 0
  }
}
