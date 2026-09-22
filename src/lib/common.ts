import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { configuredPin, pinSessionProof } from '@/lib/pin'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message)
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
export const randomToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function safePasswordEqual(input: string, expected: string) {
  const a = createHash('sha256').update(input).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function normalizePhone(input: string) {
  const clean = input.trim().replace(/[\s().-]/g, '')
  let phone = clean
  if (/^0\d{9}$/.test(clean)) phone = `+593${clean.slice(1)}`
  else if (/^9\d{8}$/.test(clean)) phone = `+593${clean}`
  else if (/^593\d{9}$/.test(clean)) phone = `+${clean}`
  assert(/^\+[1-9]\d{7,14}$/.test(phone), 400, 'Teléfono inválido. Usa el formato internacional, por ejemplo +593991234567.')
  return phone
}

export function cleanName(input: string, label = 'Nombre') {
  const name = input.trim().replace(/\s+/g, ' ')
  assert(name.length >= 2 && name.length <= 100, 400, `${label} debe tener entre 2 y 100 caracteres.`)
  return name
}

export async function audit(client: PoolClient, actor: Session, action: string, details: Record<string, unknown>) {
  await client.query('INSERT INTO audit (actor_role,actor_vendor_id,action,details) VALUES ($1,$2,$3,$4)', [actor.role, actor.vendorId, action, JSON.stringify(details)])
}

export type Session = { tokenHash: string; role: 'admin' | 'seller'; vendorId: number | null }

export async function getSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get('rf_session')?.value
  if (!token) return null
  const result = await pool.query<{ token_hash: string; credential_hash: string; role: 'admin' | 'seller'; vendor_id: number | null }>(
    'SELECT token_hash,credential_hash,role,vendor_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hashToken(token)])
  const row = result.rows[0]
  if (!row) return null
  const pin = configuredPin(row.role)
  if (!pin || !safePasswordEqual(row.credential_hash, pinSessionProof(token, row.role, pin))) return null
  return row ? { tokenHash: row.token_hash, role: row.role, vendorId: row.vendor_id } : null
}

export async function requireSession(req: NextRequest, role?: 'admin' | 'seller') {
  const session = await getSession(req)
  assert(session, 401, 'Debes ingresar para continuar.')
  if (role) assert(session.role === role, 403, 'No tienes permiso para esta operación.')
  return session
}

export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return
  let url: URL
  try { url = new URL(origin) } catch { throw new ApiError(403, 'Origen no permitido.') }
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  assert(url.host === host, 403, 'Origen no permitido.')
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status)
  if (typeof error === 'object' && error && 'name' in error && error.name === 'ZodError') return json({ error: 'Identificador no válido.' }, 400)
  if (typeof error === 'object' && error && 'code' in error) {
    if (error.code === '23505') return json({ error: 'Ese dato ya existe. Actualiza la página y vuelve a intentar.' }, 409)
    if (error.code === '23514' || error.code === '23503') return json({ error: 'Los datos enviados no son válidos.' }, 400)
  }
  console.error(error)
  return json({ error: 'Ocurrió un error en el servidor.' }, 500)
}
