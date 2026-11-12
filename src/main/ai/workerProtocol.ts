/** Phase 223 (M22) - messages between the main process (aiService) and the utility-process worker. Plain structured-clone data. */
export interface WorkerModelInit {
  id: string
  dtype: 'int8' | 'fp32'
  pooling: 'mean' | 'cls'
  normalize: boolean
  maxTokens: number
}
export type ToWorker =
  | { type: 'init'; modelRoot: string; model: WorkerModelInit }
  /** `texts` already carry the model's prefix (aiService applies it). */
  | { type: 'embed'; id: number; texts: string[] }
export type FromWorker =
  | { type: 'ready' }
  | { type: 'result'; id: number; vectors: Float32Array[]; ms: number }
  /** Without `id`: the model could not be loaded (not fixed by a restart). With `id`: that one embed failed. */
  | { type: 'error'; id?: number; message: string }
