import { describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS } from '../../settings'
import { budgetBlown, DRAWN_SCENES, isGridPage, parseColorRGB, resolveScene, SCENE_LIMITS, SCENES_ENABLED_KEY, sceneRunState, shouldDrawFrame, type SceneRunInput } from '../scenes'
import { SCENE_NAMES } from '../schemaV2'
import { validateTheme } from '../validateTheme'

const bg = (o: Partial<Parameters<typeof resolveScene>[0] & object> = {}) => ({ scene: 'particles', colors: [] as string[], density: 0.5, speed: 0.3, intensity: 0.5, ...o })
const run: SceneRunInput = { wanted: true, scenesEnabled: true, effectsEnabled: true, reduceMotion: false, failed: false, hidden: false, unfocusedPaused: false, gridPage: false }

describe('scene resolver (Phase 169)', () => {
  it('every drawn scene is a name the theme loader accepts; the setting defaults ON', () => {
    for (const s of DRAWN_SCENES) expect(SCENE_NAMES).toContain(s)
    expect(SETTING_DEFAULTS[SCENES_ENABLED_KEY]).toBe(true)
  })
  it('none, unknown, a missing background and a theme-supplied odd name resolve to no scene', () => {
    expect(resolveScene(undefined)).toBeNull()
    expect(resolveScene(bg({ scene: 'none' }))).toBeNull()
    expect(resolveScene(bg({ scene: 'my-shader' }))).toBeNull()
    expect(resolveScene(bg({ scene: '__proto__' }))).toBeNull()
  })
  it('an unknown scene in a theme file loads with a warning and draws nothing', () => {
    const r = validateTheme({ schema: 2, id: 'x', name: 'X', background: { scene: 'fireworks' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.theme.warnings?.join(' ') ?? r.warnings?.join(' ') ?? '').toContain('unknown scene')
      expect(resolveScene(r.theme.v2?.background)).toBeNull()
    }
  })
  it('colours default per scene, parse hex and rgba, cap at 4, ignore unusable ones', () => {
    expect(resolveScene(bg({ scene: 'waves' }))!.colors.length).toBe(2)
    expect(resolveScene(bg({ scene: 'gradient-mesh' }))!.colors.length).toBe(3)
    expect(parseColorRGB('#f00')).toEqual([1, 0, 0])
    expect(parseColorRGB('#00ff0080')).toEqual([0, 1, 0])
    expect(parseColorRGB('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1])
    expect(parseColorRGB('red')).toBeNull()
    const r = resolveScene(bg({ colors: ['#fff', 'nope', '#000', '#111', '#222', '#333'] }))!
    expect(r.colors.length).toBe(4)
  })
  it('density maps to particle count / wave segments inside the caps; speed and intensity are clamped', () => {
    expect(resolveScene(bg({ density: 0 }))!.count).toBe(SCENE_LIMITS.minParticles)
    expect(resolveScene(bg({ density: 1 }))!.count).toBe(SCENE_LIMITS.maxParticles)
    expect(resolveScene(bg({ density: 9 }))!.count).toBe(SCENE_LIMITS.maxParticles)
    expect(resolveScene(bg({ scene: 'waves', density: 1 }))!.count).toBe(SCENE_LIMITS.waveSegments.max)
    expect(resolveScene(bg({ scene: 'gradient-mesh' }))!.count).toBe(0)
    const r = resolveScene(bg({ speed: 99, intensity: -4 }))!
    expect(r.speed).toBe(2)
    expect(r.intensity).toBe(0)
  })
})

describe('scene run / pause / fallback decisions (Phase 169)', () => {
  it('runs only when wanted, enabled, not failed and visible', () => {
    expect(sceneRunState(run)).toBe('run')
    expect(sceneRunState({ ...run, wanted: false })).toBe('off')
    expect(sceneRunState({ ...run, scenesEnabled: false })).toBe('off')
    expect(sceneRunState({ ...run, effectsEnabled: false })).toBe('off')
    expect(sceneRunState({ ...run, reduceMotion: true })).toBe('off')
    expect(sceneRunState({ ...run, failed: true })).toBe('off')
  })
  it('pauses when hidden / minimised / tray, when unfocused (if set) and on grid pages', () => {
    expect(sceneRunState({ ...run, hidden: true })).toBe('paused')
    expect(sceneRunState({ ...run, unfocusedPaused: true })).toBe('paused')
    expect(sceneRunState({ ...run, gridPage: true })).toBe('paused')
    expect(sceneRunState({ ...run, hidden: true, failed: true })).toBe('off')
  })
  it('grid pages are Create and the dev grid pages only', () => {
    expect(isGridPage('/create')).toBe(true)
    expect(isGridPage('/')).toBe(false)
    expect(isGridPage('/history')).toBe(false)
  })
  it('the frame cap skips frames that come too soon', () => {
    expect(shouldDrawFrame(0, 5)).toBe(false)
    expect(shouldDrawFrame(0, 16.7)).toBe(true)
    expect(shouldDrawFrame(0, 20, 30)).toBe(false)
  })
  it('a blown frame budget needs a full window with many slow frames', () => {
    const slow = SCENE_LIMITS.slowFrameMs + 10
    expect(budgetBlown(Array(10).fill(slow))).toBe(false)
    expect(budgetBlown(Array(SCENE_LIMITS.budgetWindow).fill(4))).toBe(false)
    expect(budgetBlown(Array(SCENE_LIMITS.budgetWindow).fill(slow))).toBe(true)
  })
})
