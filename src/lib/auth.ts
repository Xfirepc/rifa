import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db'
import { ApiError, assert, hashToken, json, randomToken, safePasswordEqual } from '@/lib/common'
import { configuredPin, pinSessionProof } from '@/lib/pin'
import { readJson } from '@/lib/validation'

export async function loginWithPin(req: NextRequest): Promise<NextResponse> {
  const input = await readJson(req, z.object({ role: z.enum(['admin', 'seller']), pin: z.string().regex(/^[0-9]{6}$/, 'El PIN debe tener exactamente seis dígitos.') }))
  const pin = configuredPin(input.role)
  assert(pin, 503, 'Configura dos PIN distintos de seis dígitos en el servidor.')
  // Caddy supplies this header; the app port is not exposed by Compose.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const key = hashToken(`${input.role}:${ip}`)
  const client = await pool.connect()
  let failure = 0
  let token = ''
  const maxAge = input.role === 'admin' ? 12 * 3600 : 30 * 24 * 3600
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO login_attempts (key) VALUES ($1) ON CONFLICT DO NOTHING', [key])
    const { rows: [attempt] } = await client.query('SELECT failures,expires_at>now() AS current FROM login_attempts WHERE key=$1 FOR UPDATE', [key])
    if (attempt.current && attempt.failures >= 5) failure = 429
    else if (!safePasswordEqual(input.pin, pin)) {
      const failures = attempt.current ? attempt.failures + 1 : 1
      await client.query("UPDATE login_attempts SET failures=$2,expires_at=now()+interval '10 minutes' WHERE key=$1", [key, failures])
      failure = 401
    } else {
      await client.query('DELETE FROM login_attempts WHERE key=$1', [key])
      token = randomToken()
      await client.query("INSERT INTO sessions (token_hash,credential_hash,role,expires_at) VALUES ($1,$2,$3,now()+($4 || ' seconds')::interval)", [hashToken(token), pinSessionProof(token, input.role, pin), input.role, maxAge])
    }
    // Failed attempts must commit, including concurrent requests for this IP/role.
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (failure) throw new ApiError(failure, failure === 429 ? 'Demasiados intentos. Espera diez minutos.' : 'PIN incorrecto.')
  const response = json({ role: input.role, vendorId: null })
  response.cookies.set('rf_session', token, { httpOnly: true, sameSite: 'strict', secure: req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:', path: '/', maxAge })
  return response
}
