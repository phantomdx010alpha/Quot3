# THIRD_PARTY_AI — local AI model record (Milestone 22)

Written in Phase 222. Docs only: no model file is in the repo or the zip (`resources/ai-models/` is git-ignored; `tools/fetch-ai-model.mjs` downloads it on the owner's PC and in the GitHub Action). Everything marked [A] is unconfirmed and must be checked by the owner before a release ships the model.

## The default model [A1]

| Field | Value |
|---|---|
| Quot3 model id | `multilingual-e5-small` (`src/shared/ai/modelConfig.ts`, `E5_SMALL`) |
| Upstream | `intfloat/multilingual-e5-small` (Wang et al., Microsoft Research, "Multilingual E5 Text Embeddings: A Technical Report") |
| Files come from | Hugging Face repo `Xenova/multilingual-e5-small` (ONNX conversion of the same weights, used by transformers.js) [A] |
| Licence | MIT [A] |
| Revision | NOT pinned yet. Run `node --experimental-strip-types tools/fetch-ai-model.mjs --allow-unpinned` once; it prints the commit and each SHA-256 to paste into `modelConfig.ts`. |
| Files (expected) | `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `onnx/model_quantized.onnx` (int8, about 118 MB) [A: exact names and sizes come from the first fetch] |
| SHA-256 | placeholders (empty) until the first fetch |
| Prefix policy | `query: ` for typed text, `passage: ` for stored names (required by e5) |
| Output | 384 dimensions, mean pooling, L2-normalised |

### Licence check status

- **Phase 222 session (2026-11-12):** the sandbox cannot open `huggingface.co`. A web search returned third-party pages (model mirrors and catalogues) that all state MIT for `intfloat/multilingual-e5-small`. That is secondary evidence, NOT a reading of the official model card. `licenceConfirmed` therefore stays `false` in `modelConfig.ts`.
- **Owner / Phase 231 action:** open `https://huggingface.co/intfloat/multilingual-e5-small` and `https://huggingface.co/Xenova/multilingual-e5-small`, confirm "License: MIT" on both, paste the licence text link below, then set `licenceConfirmed: true`. If either says anything other than a permissive licence, stop and ask the owner (rule from the Phase 222 entry).
- **Phase 231 follow-up (2026-11-12): licence confirmed by the owner [A].** The owner read the MIT licence text on Hugging Face (generic MIT text, "Copyright (c) [year] [fullname]") and pasted it into the session; `licenceConfirmed` is now `true`. The owner did not say which of the two pages the pasted text came from, so the other page should be glanced at once [A]. Licence pages: `https://huggingface.co/intfloat/multilingual-e5-small` and `https://huggingface.co/Xenova/multilingual-e5-small`.
- **Pinned by the owner's own first fetch (2026-11-12):** revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`; the five SHA-256 values are in `src/shared/ai/modelConfig.ts` (from `model-manifest.json`; `onnx/model_quantized.onnx` is 118,308,185 bytes).

## Bake-off candidates [A] (not shipped)

| Id | Upstream | Licence (unconfirmed) | Note |
|---|---|---|---|
| `all-MiniLM-L6-v2` | `sentence-transformers/all-MiniLM-L6-v2` via `Xenova/all-MiniLM-L6-v2` | Apache-2.0 [A] | about 23 MB, English only, no prefixes |
| `granite-embedding-97m-multilingual-r2` | `ibm-granite/granite-embedding-97m-multilingual-r2` | Apache-2.0 [A] | licence AND dimension AND ONNX file name unchecked; must be checked before it could ship |

## Runtime packages (installed in Phase 223, read from `package-lock.json`)

| Package | Version | Licence (from the lockfile) | Role |
|---|---|---|---|
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | runs the model in the utility process |
| `onnxruntime-node` | 1.30.0 | MIT | native ONNX runtime (Windows x64 binaries unpacked from the asar) |
| `onnxruntime-common` | 1.30.0 | MIT | its shared code |
| `onnxruntime-web` | 1.31.0-dev.20260914-8d85527a0 | MIT | dependency of transformers; a dev build; not used on Quot3's node path [A] |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | tokenizer |
| `@huggingface/jinja` | 0.5.12 | MIT | template engine used by transformers |
| `sharp` | 0.35.5 | Apache-2.0 | image library pulled in by transformers (images are not used by Quot3) [A] |

Licence texts of these packages ship with their npm folders inside the installer's `node_modules`; Phase 231 re-checks that the installer's notice lists them [A].

## What ships (planned, Phase 223 / 231)

Model files under the installer's `resources/ai-models/<id>/` (`extraResources`), plus the licence text and this notice. Nothing is downloaded by the app at runtime.

## Phase 231 reconciliation (2026-11-12, release 0.1.52 [A])

- **Packages:** the table above was compared with `package-lock.json` by a Node one-liner; every version and licence matches (transformers 4.3.2 Apache-2.0, onnxruntime-node / -common 1.30.0 MIT, onnxruntime-web 1.31.0-dev.20260914-8d85527a0 MIT, tokenizers 0.2.0 Apache-2.0, jinja 0.5.12 MIT, sharp 0.35.5 Apache-2.0). Not checked: that the installer's own notice file lists them (no build was run) [A].
- **Model: STILL NOT PINNED.** `revision` and every `sha256` in `src/shared/ai/modelConfig.ts` are empty and `licenceConfirmed` is `false`. The sandbox cannot open `huggingface.co`, so nothing could be read from the official model cards or fetched. Consequence: the GitHub Action (`--skip-if-unpinned`) builds an installer WITHOUT a model, and Settings > AI shows "Not installed" until the owner does `docs/M22_OWNER_CHECKLIST.md` section 1 and pushes the pinned values.
- **Licence text link:** still to be filled by the owner (see above).
- **What ships in 0.1.52:** the AI code, the packaged `onnxruntime-node` Windows x64 binaries, this notice (`resources/THIRD_PARTY_AI.txt`) and, only after the owner pins it, the model files under `resources/ai-models/<id>/`.
