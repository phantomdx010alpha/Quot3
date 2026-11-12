import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelConfig } from '../../shared/ai/modelConfig'

/** True when every file of the model is on disk under its folder (`<resourcesRoot>/ai-models/<id>/`). Pure fs, no Electron. */
export const modelFilesPresent = (cfg: ModelConfig, modelRoot: string): boolean => cfg.files.every((f) => existsSync(join(modelRoot, ...f.path.split('/'))))

/** Phase 230: total bytes of the model files on disk (0 for a missing file; never throws). */
export function modelFilesBytes(cfg: ModelConfig, modelRoot: string): number {
  let n = 0
  for (const f of cfg.files) { try { n += statSync(join(modelRoot, ...f.path.split('/'))).size } catch { /* missing file: counts 0 */ } }
  return n
}
