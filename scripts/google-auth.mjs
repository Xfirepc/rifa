import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import { SHEETS_SCOPE } from './sheets-core.mjs'

export function oauthConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    /^[a-fA-F0-9]{64}$/.test(process.env.GOOGLE_TOKEN_KEY ?? '') && validRedirectUri())
}

function validRedirectUri() {
  try {
    const url = new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '')
    return !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/api/admin/sheets/oauth/callback' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch { return false }
}

export function oauthClient() {
  if (!oauthConfigured()) throw Object.assign(new Error('Google OAuth no está configurado.'), { code: 'GOOGLE_CONFIG' })
  return new OAuth2Client({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI })
}

function tokenKey() {
  const value = process.env.GOOGLE_TOKEN_KEY ?? ''
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Configura GOOGLE_TOKEN_KEY con 64 caracteres hexadecimales.')
  return Buffer.from(value, 'hex')
}

export function encryptToken(token) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv)
  cipher.setAAD(Buffer.from('rifa-google-oauth-v1'))
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.')
}

export function decryptToken(encrypted) {
  const [iv, tag, data] = encrypted.split('.').map(value => Buffer.from(value, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', tokenKey(), iv)
  cipher.setAAD(Buffer.from('rifa-google-oauth-v1'))
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
}

export function createGoogleTransport(pool) {
  const service = new GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: [SHEETS_SCOPE] })
  let cached = null
  let cachedCredential = ''
  async function getClient() {
    if (process.env.GOOGLE_AUTH_MODE === 'service_account') return service.getClient()
    const { rows: [connection] } = await pool.query('SELECT client_id,refresh_token_encrypted FROM google_connection WHERE id=1')
    if (!connection || connection.client_id !== process.env.GOOGLE_OAUTH_CLIENT_ID) throw Object.assign(new Error('Google no está conectado.'), { code: 'GOOGLE_NOT_CONNECTED' })
    if (!cached || cachedCredential !== connection.refresh_token_encrypted) {
      cached = oauthClient()
      cached.setCredentials({ refresh_token: decryptToken(connection.refresh_token_encrypted) })
      cachedCredential = connection.refresh_token_encrypted
    }
    return cached
  }
  return {
    async getMetadata(id) {
      const client = await getClient()
      const response = await client.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${id}`, params: { fields: 'sheets.properties' }, timeout: 200_000, retry: false })
      return response.data
    },
    async write(id, requests) {
      const client = await getClient()
      await client.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, method: 'POST', data: { requests }, timeout: 200_000, retry: false })
    },
  }
}
