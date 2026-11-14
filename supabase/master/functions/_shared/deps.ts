/**
 * Phase 260 - build the real `Deps` inside Deno from the function secrets (C1 env): `MASTER_KEK`, `MASTER_PEPPER`,
 * `ALLOWED_ORIGIN`, and Supabase's own `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` of the MASTER project.
 * Only the Deno entry files import this; tests inject fakes instead. NEVER run from the sandbox.
 */
import { keyFromBase64Url, randomBytes } from '../../../../src/shared/master/seal'
import { redactText } from '../../../../src/shared/master/redact'
import { pgrestDb } from './pgrest'
import { CompanyCallError, type CompanyClient, type Deps } from './types'

declare const Deno: { env: { get(name: string): string | undefined } }

/** The company project's `/auth/v1/user` with the company anon key and the device's access token. */
export const httpCompanyClient: CompanyClient = {
  async getUser(company, accessToken) {
    const res = await fetch(`${company.supabase_url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: company.anon_key, authorization: `Bearer ${accessToken}` }
    })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) throw new Error(`company auth answered ${res.status}`)
    const u = (await res.json()) as { id?: unknown; email?: unknown }
    return typeof u.id === 'string' ? { id: u.id, email: typeof u.email === 'string' ? u.email : null } : null
  },
  async adminRpc(company, key, fn, args) {
    return companyFetch(company.supabase_url, key, 'POST', `rpc/${fn}`, args)
  },
  async adminSelect(company, key, path) {
    return (await companyFetch(company.supabase_url, key, 'GET', path)) as unknown[]
  }
}

/** One PostgREST call to a company project with its service_role key. Network / 5xx -> unreachable, 4xx -> refused. */
async function companyFetch(baseUrl: string, key: string, method: string, path: string, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/${path}`, {
      method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
    })
  } catch {
    throw new CompanyCallError('unreachable')
  }
  if (res.status >= 500) throw new CompanyCallError('unreachable')
  if (!res.ok) throw new CompanyCallError('refused')
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function need(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`missing function secret ${name}`)
  return v
}

export function realDeps(): Deps {
  return {
    db: pgrestDb(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY')),
    company: httpCompanyClient,
    kek: keyFromBase64Url(need('MASTER_KEK')),
    pepper: need('MASTER_PEPPER'),
    allowedOrigin: Deno.env.get('ALLOWED_ORIGIN') ?? '',
    now: () => new Date(),
    randomBytes,
    log: (line) => console.log(redactText(line))
  }
}
