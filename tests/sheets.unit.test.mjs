import test from 'node:test'
import assert from 'node:assert/strict'
import { isPin, pinSessionProof } from '../src/lib/pin.ts'
import { encryptToken, decryptToken, oauthConfigured } from '../scripts/google-auth.mjs'
import { sheetData, buildSheetsRequests, retryDelay, safeSyncError } from '../scripts/sheets-core.mjs'

test('PIN de seis dígitos y sesiones vinculadas al PIN y al rol', () => {
  assert.equal(isPin('000007'), true)
  for (const pin of ['12345', '1234567', '12 456', 'abcdef', 123456]) assert.equal(isPin(pin), false)
  const proof = pinSessionProof('cookie-a', 'admin', '000007')
  assert.notEqual(proof, pinSessionProof('cookie-b', 'admin', '000007'))
  assert.notEqual(proof, pinSessionProof('cookie-a', 'seller', '000007'))
  assert.notEqual(proof, pinSessionProof('cookie-a', 'admin', '000008'))
})

test('autorizaciones cifradas: no revelan el token y rechazan alteraciones', () => {
  process.env.GOOGLE_TOKEN_KEY = 'ab'.repeat(32)
  const one = encryptToken('refresh-token-test')
  assert.equal(decryptToken(one), 'refresh-token-test')
  assert.ok(!one.includes('refresh-token-test'))
  assert.notEqual(one, encryptToken('refresh-token-test'))
  const parts = one.split('.')
  parts[1] = Buffer.alloc(16).toString('base64url')
  assert.throws(() => decryptToken(parts.join('.')))
  process.env.GOOGLE_TOKEN_KEY = 'cd'.repeat(32)
  assert.throws(() => decryptToken(one))
  process.env.GOOGLE_TOKEN_KEY = 'ab'.repeat(32)
})

test('50 boletos con precios mixtos, teléfonos como texto y sin interpretar fórmulas', () => {
  const snapshot = { items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, sale_id: 1, ticket_number: i + 1, price_cents: i < 25 ? 150 : 100, created_at: '2026-09-22T15:00:00Z', canceled_at: null, vendor_name: '=IMPORTXML("https://example.invalid")', participant_name: 'Comprador', phone: '+593991234567' })), vendors: [{ name: 'Ana', quota: 50, sold_count: 50, total_cents: '6250' }] }
  const [sales, summary] = sheetData(snapshot)
  assert.equal(sales.rows.length, 51)
  assert.equal(sales.rows[1][2], '0001')
  assert.equal(sales.rows[1][3], '2026-09-22 10:00:00')
  assert.equal(sales.rows.slice(1).reduce((sum, row) => sum + row[7], 0), 62.50)
  assert.equal(summary.rows[1][4], 62.50)
  const requests = buildSheetsRequests(snapshot, { sheets: [{ properties: { sheetId: 900, title: 'Notas personales' } }] })
  const cells = requests.filter(r => r.updateCells).map(r => r.updateCells)
  assert.deepEqual(cells[0].rows[1].values[4].userEnteredValue, { stringValue: snapshot.items[0].vendor_name })
  assert.deepEqual(cells[0].rows[1].values[6].userEnteredValue, { stringValue: '+593991234567' })
  assert.ok(!JSON.stringify(requests).includes('formulaValue'))
  assert.ok(!requests.some(r => Object.values(r).some(v => v.range?.sheetId === 900)))
  assert.ok(!requests.some(r => r.appendCells))
})

test('errores de Google se resumen sin filtrar credenciales; reintentos acotados', () => {
  assert.equal(retryDelay(1, () => 0), 15000)
  assert.equal(retryDelay(20, () => 1), 300000)
  const error = { message: 'SECRET-123', response: { status: 403, data: { client_secret: 'SECRET-123' } } }
  assert.ok(!safeSyncError(error).includes('SECRET-123'))
  assert.match(safeSyncError({ response: { status: 429 } }), /limitó/)
  assert.match(safeSyncError({ code: 'GOOGLE_NOT_CONNECTED' }), /Conecta Google/)
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://example.com/api/admin/sheets/oauth/callback'
  assert.equal(oauthConfigured(), false)
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost/api/admin/sheets/oauth/callback'
  assert.equal(oauthConfigured(), true)
})
