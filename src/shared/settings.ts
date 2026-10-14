/** Settings keys, defaults and limits (pure). Stored in the `settings` table as JSON; see DATA_MODEL.md. */
import { DEFAULT_THEME_ID } from './theme/tokens'

export const SETTING_KEY_RE = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/
export const SETTING_VALUE_MAX_BYTES = 64 * 1024

/** Known keys with defaults. Later phases add theirs here (company.*, print.*, trash.retentionDays, …). */
export const SETTING_DEFAULTS: Readonly<Record<string, unknown>> = {
  'ui.theme': DEFAULT_THEME_ID,
  /** Phase 23: per-format column width overrides, `{ [formatId]: { [colKey]: px } }` (see shared/columnWidths.ts). */
  'grid.colWidths': {},
  /** Phase 157: History lists only the last N days of bills by default (0 = all). A search or a From / To range always looks at every date. */
  'history.defaultDays': 30,
  /** Phase 37: printing. The Settings screens (Phase 48) edit these; until then the defaults apply. */
  'print.rupeeOnTotal': true,
  /** 0.1.6 (testing): true = the printed page and copied image leave out the Adjustments total row (Create screen unchanged). */
  'print.hideAdjustmentsTotal': false,
  /** Phase 148: fit the bill to the page (scale type and rows UP, capped, measured). true = on (default); false = exactly the old size. */
  'print.fitToPage': true,
  /** Phase 148: the largest enlargement per paper (1 = none, 1.35 = 35% bigger). */
  'print.fitMaxA5': 1.35,
  'print.fitMaxA4': 1.25,
  /** Print without the system dialog - only honoured when `print.printer` is also set. */
  'print.silent': false,
  /** Windows printer name for silent printing; '' = system default / dialog. */
  'print.printer': '',
  /** How Print reaches paper: 'viewer' (default: open the PDF in the PC's PDF app, press Print there), 'direct' (send the PDF to the printer), 'browser' (older HTML print). */
  'print.method': 'viewer',
  /** Phase 43: days a deleted bill stays in Recently deleted before the launch sweep purges it (the Settings screen is Phase 48/49). */
  'trash.retentionDays': 30,
  /** Phase 61: days the activity log is kept (30..3650); older rows are removed at launch. */
  'audit.retentionDays': 365,
  /** Phase 62: background update checks (45 s after launch, then every 6 h), the channel, and an optional feed ('' = the address built into the installer; `github:owner/repo` or an https:// folder). */
  'updates.auto': true,
  'updates.channel': 'stable',
  'updates.feedUrl': '',
  /** 0.1.5: the version the owner chose in Settings > Updates > Choose app version ('' = none). While it equals the running version, background checks are paused; any other running version clears it. */
  'updates.pinnedVersion': '',
  /** 0.1.5: the value of `updates.auto` before the pin switched it off, restored by "Back to latest" (older builds only understand `updates.auto`). */
  'updates.autoBeforePin': true,
  /** Phase 49: density / font-size preferences on top of the theme. null = the theme decides (see shared/settings/uiPrefs.ts). */
  /** Phase 125: dashboard live tiles. City (default Bangalore; set via dashboard:setCity), tile on/off flags, and the last good live values (cache, written by the main process). */
  'dash.city': { name: 'Bangalore', region: 'Karnataka', country: 'India', lat: 12.9719, lon: 77.5937 },
  'dash.tiles': { weather: true, usd: true, majors: true, metals: true, clock: true, holidays: true },
  'dash.cache': {},
  'ui.rowHeight': null,
  'ui.gridFontSize': null
}
