// Test helper: reads docs/reference/legacy_import/Bills_JSON.zip with node:zlib only (no dependency). Private business data: never logged.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { LegacyFileInput } from '../plan'

export function corpusPath(): string { return join(__dirname, '../../../../docs/reference/legacy_import/Bills_JSON.zip') }

export function readCorpus(): LegacyFileInput[] | null {
  const p = corpusPath()
  if (!existsSync(p)) return null
  const buf = readFileSync(p)
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out: LegacyFileInput[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const csize = buf.readUInt32LE(off + 20)
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8')
    off += 46 + nlen + elen + clen
    if (!name.toLowerCase().endsWith('.json')) continue
    const ln = buf.readUInt16LE(lho + 26), le = buf.readUInt16LE(lho + 28)
    const data = buf.subarray(lho + 30 + ln + le, lho + 30 + ln + le + csize)
    const raw = method === 0 ? data : inflateRawSync(data)
    out.push({ name: name.split('/').pop()!, text: raw.toString('utf8'), bytes: raw.length })
  }
  return out
}
