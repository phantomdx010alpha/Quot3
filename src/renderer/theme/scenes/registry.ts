import type { SceneName } from '@shared/theme/scenes'
import type { SceneBuilder } from './types'
import { buildGradientMesh } from './gradientMesh'
import { buildParticles } from './particles'
import { buildWaves } from './waves'

/** The scenes built into the app, by the names a theme may pick (schemaV2.SCENE_NAMES minus `none`). A theme cannot add one. */
export const SCENE_BUILDERS: Readonly<Record<SceneName, SceneBuilder>> = {
  particles: buildParticles,
  waves: buildWaves,
  'gradient-mesh': buildGradientMesh
}
export const builderFor = (name: string): SceneBuilder | null => (Object.prototype.hasOwnProperty.call(SCENE_BUILDERS, name) ? SCENE_BUILDERS[name as SceneName] : null)
