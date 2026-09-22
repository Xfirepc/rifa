import { NextRequest, NextResponse } from 'next/server'
import { CodeChallengeMethod } from 'google-auth-library'
import { oauthClient, oauthConfigured, encryptToken } from '../../scripts/google-auth.mjs'
import { SHEETS_SCOPE } from '../../scripts/sheets-core.mjs'
import { pool } from '@/lib/db'
import { assert, hashToken, json, randomToken, requireSession, safePasswordEqual } from '@/lib/common'
import { configuredPin, pinSessionProof } from '@/lib/pin'

const cookieName = 'rf_google_state'
const cookiePath = '/api/admin/sheets/oauth/callback'

export async function beginGoogleOAuth(req: NextRequest) {
  const session = await requireSession(req, 'admin')
  assert(oauthConfigured(), 503, 'Configura el Client ID, Client Secret, clave de cifrado y URL de retorno de Google en el servidor.')
  const client = oauthClient()
  const state = randomToken()
  const browser = randomToken()
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const pin = configuredPin('admin')
  assert(pin, 503, 'El PIN de administración no está configurado.')
  await pool.query('DELETE FROM google_oauth_state WHERE expires_at<now() OR session_hash=$1', [session.tokenHash])
  await pool.query(`INSERT INTO google_oauth_state (state_hash,browser_hash,session_hash,pin_proof,verifier,expires_at)
    VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [hashToken(state), hashToken(browser), session.tokenHash, pinSessionProof(state, 'admin', pin), codeVerifier])
  const url = client.generateAuthUrl({ scope: [SHEETS_SCOPE], access_type: 'offline', prompt: 'consent', state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 })
  const response = json({ url })
  // The main session stays SameSite=Strict. This short-lived cookie permits Google's return.
  response.cookies.set(cookieName, browser, { httpOnly: true, sameSite: 'lax', secure: process.env.GOOGLE_OAUTH_REDIRECT_URI!.startsWith('https:'), path: cookiePath, maxAge: 600 })
  return response
}

export async function finishGoogleOAuth(req: NextRequest) {
  assert(oauthConfigured(), 503, 'Google OAuth no está configurado.')
  const state = req.nextUrl.searchParams.get('state') ?? ''
  const browser = req.cookies.get(cookieName)?.value ?? ''
  assert(state.length >= 32 && state.length <= 128 && browser.length >= 32 && browser.length <= 128, 403, 'La autorización no es válida. Vuelve a conectar Google desde administración.')
  const { rows: [flow] } = await pool.query(`DELETE FROM google_oauth_state g WHERE state_hash=$1 AND browser_hash=$2
    AND expires_at>now() AND EXISTS (SELECT 1 FROM sessions s WHERE s.token_hash=g.session_hash AND s.role='admin' AND s.expires_at>now()) RETURNING *`, [hashToken(state), hashToken(browser)])
  const pin = configuredPin('admin')
  assert(flow && pin && safePasswordEqual(flow.pin_proof, pinSessionProof(state, 'admin', pin)), 403, 'La autorización venció. Vuelve a conectar Google desde administración.')
  let result = 'denied'
  if (!req.nextUrl.searchParams.has('error')) {
    try {
      const code = req.nextUrl.searchParams.get('code')
      assert(code && code.length < 4096, 400, 'Google no envió el código de autorización.')
      const { tokens } = await oauthClient().getToken({ code, codeVerifier: flow.verifier })
      assert(tokens.refresh_token, 400, 'Google no concedió acceso permanente. Vuelve a conectar y acepta el permiso.')
      assert(!tokens.scope || tokens.scope.split(' ').includes(SHEETS_SCOPE), 403, 'Falta el permiso de Google Sheets.')
      const connection = await pool.connect()
      try {
        await connection.query('BEGIN')
        await connection.query(`INSERT INTO google_connection (id,client_id,refresh_token_encrypted) VALUES (1,$1,$2)
          ON CONFLICT (id) DO UPDATE SET client_id=excluded.client_id,refresh_token_encrypted=excluded.refresh_token_encrypted,connected_at=now()`, [process.env.GOOGLE_OAUTH_CLIENT_ID, encryptToken(tokens.refresh_token)])
        await connection.query('UPDATE sheet_sync SET revision=revision+1,next_attempt_at=now(),last_error=NULL,failures=0 WHERE id=1')
        await connection.query('COMMIT')
      } catch (error) { await connection.query('ROLLBACK'); throw error }
      finally { connection.release() }
      result = 'connected'
    } catch { result = 'error' }
  }
  const response = NextResponse.redirect(new URL(`/?google=${result}`, new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI!).origin), 303)
  response.cookies.set(cookieName, '', { path: cookiePath, maxAge: 0, httpOnly: true, sameSite: 'lax' })
  return response
}
