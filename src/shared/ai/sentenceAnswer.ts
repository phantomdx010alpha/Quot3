/** Phase 229 (M22) - the shape of `ai:searchSentence`'s answer (pure types and limits, shared by main, preload and the renderer). */
export type SentenceFormat = 'gst' | 'nongst'
export interface SentenceSearchAnswer {
  /** Model score 0..1 by bill id for bills that looked similar; empty when the model did not answer (off, missing, failing). */
  scores: Record<string, number>
  /** The bill's format by id (read from the items index, no model needed); empty when AI is off. */
  formats: Record<string, SentenceFormat>
  /** True when `scores` came from the model. */
  embeddingsUsed: boolean
}
export const SENTENCE_IDS_MAX = 1000
