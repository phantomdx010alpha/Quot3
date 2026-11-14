// Phase 261 - Deno entry. Deployed as a BUNDLE (Phase 262 prints the step): the handler and the shared core use
// extension-less imports, so bundle with esbuild first. NEVER run from the sandbox.
import { handleEnrol } from './handler'
import { realDeps } from '../_shared/deps'

Deno.serve((req: Request) => handleEnrol(req, realDeps()))
