// Phase 280 - Deno entry. Deployed as a BUNDLE like profile-set (extension-less imports; bundle with esbuild first). NEVER run from the sandbox.
import { handlePaymentsSet } from './handler'
import { realDeps } from '../_shared/deps'

Deno.serve((req: Request) => handlePaymentsSet(req, realDeps()))
