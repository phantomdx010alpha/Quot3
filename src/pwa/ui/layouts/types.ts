import type { ComponentType, MutableRefObject, ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import type { PhoneDb } from '../../data/db'
import type { RouteName, TabRoute } from '../../router'
import type { EditorApi } from '../editor/BillEditor'
import type { DashboardView } from '../dashboardModel'
import type { StatusActionId, StatusFlags } from '../kit/statusModel'
import type { LayoutId } from './layoutRegistry'

/** What a layout Shell receives from App.tsx. App keeps ALL state (router, unsaved guard, banners, theme, lock); a layout only draws it. */
export interface ShellProps {
  route: RouteName
  param?: string
  canGoBack: boolean
  /** Goes through the unsaved-bill guard, like the classic Back button. */
  onBack: () => void
  onSelectTab: (tab: TabRoute) => void
  /** The tab to light (a pushed page keeps its parent tab lit). Phase 192. */
  activeTab?: TabRoute
  /** The page title App.tsx works out (Settings sub pages included). Phase 192. */
  title?: string
  /** The flags App.tsx already holds, drawn as the status pill (Phase 192); `onStatusAction` runs the same handlers the classic banners use. */
  status?: StatusFlags
  onStatusAction?: (id: StatusActionId) => void
  children: ReactNode
}

/** What a layout screen receives. Screens read through the existing `*Model.ts` / `data/*` code; they add no bill logic. */
export interface ScreenProps {
  db: PhoneDb | null
  now?: () => Date
  param?: string
  onNavigate: (route: RouteName, param?: string) => void
  onChanged?: () => void
  /** Back through the unsaved-bill guard (Phase 192). */
  onBack?: () => void
  /** What App.tsx loaded for Home (Phase 192); a layout's Home draws it. */
  dashboard?: { view: DashboardView | null; error: string | null }
  /** Bill view only: the bill was just saved, so the layout shows its \"Saved\" sheet until `onSavedDone` (Phase 192). */
  justSaved?: boolean
  onSavedDone?: () => void
}

/** The SAME props as `BillEditor` (contract M18-4). The layout's editor fills `apiRef.current` with `EditorApi` (`save`, `discard`). */
export interface EditorProps {
  db: PhoneDb | null
  id?: string
  now?: () => Date
  apiRef?: MutableRefObject<EditorApi | null>
  onDirtyChange?: (dirty: boolean) => void
  onChanged?: () => void
  onSaved: (id: string) => void
}

export interface LayoutNavItem {
  route: TabRoute | 'more'
  label: string
  Icon: Icon
}

/** Classic only MARKS that it is built: App.tsx renders its existing JSX unchanged. */
export interface ClassicLayoutDefinition {
  id: 'classic'
}

/** A new layout (tidy, guided, inbox), added by its own phase. `interceptBack` (guided only) is asked BEFORE the unsaved guard and returns
 *  true when it consumed the Back (a step back inside the editor). */
export interface BuiltLayoutDefinition {
  id: Exclude<LayoutId, 'classic'>
  Shell: ComponentType<ShellProps>
  screens: Partial<Record<RouteName, ComponentType<ScreenProps>>>
  Editor: ComponentType<EditorProps>
  navItems: readonly LayoutNavItem[]
  /** Routes this layout does not redraw: App.tsx draws the classic page for them inside this layout's Shell (Phase 192). */
  reusesClassic?: readonly RouteName[]
  interceptBack?: () => boolean
}

export type LayoutDefinition = ClassicLayoutDefinition | BuiltLayoutDefinition
