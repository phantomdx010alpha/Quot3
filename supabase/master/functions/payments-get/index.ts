// Phase 280 - Deno entry. Deployed as a BUNDLE like profile-get (extension-less imports; bundle with esbuild first). NEVER run from the sandbox.
import { handlePaymentsGet } from './handler'
import { realDeps } from '../_shared/deps'

Deno.serve((req: Request) => handlePaymentsGet(req, realDeps()))
