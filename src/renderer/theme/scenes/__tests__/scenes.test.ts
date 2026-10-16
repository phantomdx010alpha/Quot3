// @vitest-environment jsdom
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { DRAWN_SCENES, resolveScene } from '@shared/theme/scenes'
import { builderFor, SCENE_BUILDERS } from '../registry'
import { createSceneHost } from '../sceneHost'
import { getSceneSnapshot, markSceneFailed, setScenesEnabled, setThemeBackground, subscribeScene } from '../sceneState'

const bg = (scene: string) => ({ scene, colors: ['#2a6cff', '#c24dff'], density: 0.2, speed: 1, intensity: 0.7 })

describe('scene modules (Phase 169, Node level, real three without WebGL)', () => {
  it('the registry has exactly the drawn scenes and rejects anything else', () => {
    expect(Object.keys(SCENE_BUILDERS).sort()).toEqual([...DRAWN_SCENES].sort())
    expect(builderFor('none')).toBeNull()
    expect(builderFor('constructor')).toBeNull()
    expect(builderFor('toString')).toBeNull()
  })
  for (const name of DRAWN_SCENES) {
    it(`${name}: builds, updates and disposes with the real three module`, () => {
      const params = resolveScene(bg(name))!
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100)
      const inst = builderFor(name)!({ THREE, scene, camera, params })
      expect(scene.children.length).toBe(1)
      inst.update(0); inst.update(1.5)
      inst.dispose()
      expect(scene.children.length).toBe(0)
    })
  }
})

describe('scene host fallbacks (Phase 169)', () => {
  it('no WebGL (jsdom has none): onFail is called once and nothing throws', async () => {
    const onFail = vi.fn()
    const host = createSceneHost(document.createElement('canvas'), onFail)
    host.setRunState('run')
    host.setScene(resolveScene(bg('particles')))
    await new Promise((r) => setTimeout(r, 50))
    expect(onFail).toHaveBeenCalledTimes(1)
    host.dispose()
  })
  it('a loader that fails (three missing) falls back the same way', async () => {
    const onFail = vi.fn()
    const host = createSceneHost(document.createElement('canvas'), onFail, () => Promise.reject(new Error('x')))
    host.setRunState('run')
    host.setScene(resolveScene(bg('waves')))
    await new Promise((r) => setTimeout(r, 20))
    expect(onFail).toHaveBeenCalledTimes(1)
    host.dispose()
  })
  it('state off / no scene never loads three', async () => {
    const loader = vi.fn(async () => THREE)
    const host = createSceneHost(document.createElement('canvas'), vi.fn(), loader)
    host.setScene(resolveScene(bg('waves'))) // state is still off
    host.setScene(null)
    await new Promise((r) => setTimeout(r, 10))
    expect(loader).not.toHaveBeenCalled()
    host.dispose()
  })
})

describe('scene snapshot (Phase 169, Phase 92 selector rule)', () => {
  it('is stable until something changes; an unknown scene is no scene; a failure is remembered per theme', () => {
    setThemeBackground(undefined)
    const a = getSceneSnapshot()
    expect(getSceneSnapshot()).toBe(a)
    setThemeBackground({ scene: 'fireworks', colors: [], density: 0.5, speed: 0.3, intensity: 0.5 })
    expect(getSceneSnapshot().scene).toBeNull()
    const l = vi.fn()
    const off = subscribeScene(l)
    setThemeBackground(bg('waves'))
    expect(getSceneSnapshot().scene?.scene).toBe('waves')
    markSceneFailed()
    expect(getSceneSnapshot().failedKey).toBe(getSceneSnapshot().sceneKey)
    setThemeBackground(bg('particles')) // a different theme retries
    expect(getSceneSnapshot().failedKey).toBe('')
    setScenesEnabled(false)
    expect(getSceneSnapshot().scenesEnabled).toBe(false)
    setScenesEnabled(true)
    off()
    expect(l).toHaveBeenCalled()
    setThemeBackground(undefined)
  })
})
