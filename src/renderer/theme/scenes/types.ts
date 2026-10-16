import type * as THREE_NS from 'three'
import type { ResolvedScene } from '@shared/theme/scenes'

/** three.js is passed in (loaded lazily by the host), so scene modules never import it at load time. */
export type ThreeLib = typeof THREE_NS

export interface SceneContext {
  THREE: ThreeLib
  scene: THREE_NS.Scene
  camera: THREE_NS.PerspectiveCamera
  params: ResolvedScene
}
export interface SceneInstance {
  /** `t` = seconds since the scene started (already multiplied by nothing: scenes apply `params.speed` themselves). */
  update(t: number): void
  dispose(): void
}
export type SceneBuilder = (ctx: SceneContext) => SceneInstance

/** Colour `i` (wraps around the theme's 1-4 colours); resolveScene guarantees at least one. */
export function colorAt(p: ResolvedScene, i: number): [number, number, number] {
  return p.colors[i % p.colors.length] ?? [1, 1, 1]
}

/** Deterministic pseudo-random in [0,1) so a scene looks the same each time (no Math.random, no hidden state). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
