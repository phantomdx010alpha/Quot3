/** Settings keys, defaults and limits (pure). Stored in the `settings` table as JSON; see DATA_MODEL.md. */
import { DEFAULT_THEME_ID } from './theme/tokens'
import { LEGACY_WATCH_DEFAULTS } from './legacyWatch/watchConfig'
import { BACKGROUND_DEFAULTS } from './background'
import { SCENES_ENABLED_DEFAULT, SCENES_ENABLED_KEY } from './theme/scenes'
import { THEME_SHARE_DEFAULT, THEME_SHARE_KEY } from './theme/themeShare'
import { EFFECTS_ENABLED_DEFAULT, EFFECTS_ENABLED_KEY, EFFECTS_OVERRIDES_KEY, EFFECTS_PAUSE_UNFOCUSED_DEFAULT, EFFECTS_PAUSE_UNFOCUSED_KEY } from './theme/effects'

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
  /** 0.1.13: printed / image column headers by column key; empty = the defaults (S.No, Qty, then each format's own label). */
  'print.headerLabels': {},
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
  /** Phase 167: master switch for theme animations (default ON; Off = today's look exactly). */
  [EFFECTS_ENABLED_KEY]: EFFECTS_ENABLED_DEFAULT,
  [EFFECTS_PAUSE_UNFOCUSED_KEY]: EFFECTS_PAUSE_UNFOCUSED_DEFAULT,
  [EFFECTS_OVERRIDES_KEY]: {},
  /** Phase 169: 3D / shader theme backgrounds (default ON, only used when a theme asks for a scene). */
  [SCENES_ENABLED_KEY]: SCENES_ENABLED_DEFAULT,
  /** Phase 171: "Share my themes with the other PCs" (OFF by default [A]). Needs the shared notebook; see shared/theme/themeShare.ts. */
  [THEME_SHARE_KEY]: THEME_SHARE_DEFAULT,
  /** Phase 198 (M19 Games): switch for the Games page, its nav item, shortcut, palette entry and Dashboard tile; and the per-PC favourites / history (see shared/games/gamesState.ts). */
  'games.enabled': true,
  'games.state': { favourites: [], lastPlayed: {}, plays: {} },
  /** Phase 205 (M20): show the games whose interface is Chinese (hidden by default); the "(?)" tile and random pick never use them while it is off. */
  'games.showChinese': false,
  'ui.rowHeight': null,
  'ui.gridFontSize': null,
  /** Phase 160: legacy watch (folder path, on / off, rescan seconds). All OFF by default; see shared/legacyWatch/watchConfig.ts. */
  ...LEGACY_WATCH_DEFAULTS,
  /** Phase 161: start with Windows / keep running in the tray when the window is closed. Both OFF by default; see shared/background.ts. */
  ...BACKGROUND_DEFAULTS
}
