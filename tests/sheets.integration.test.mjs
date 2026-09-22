import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readSnapshot, syncOnce, SHEETS_SCOPE } from '../scripts/sheets-core.mjs'
import { encryptToken } from '../scripts/google-auth.mjs'

const base = process.env.TEST_BASE_URL
class Client {
  cookies = new Map()
  async call(method, path, body) {
    const response = await fetch(`${base}/api/${path}`, { method, redirect: 'manual', headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const index = pair.indexOf('='); this.cookies.set(pair.slice(0, index), pair.slice(index + 1)) }
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null }
  }
}

test('PIN, permisos y flujo OAuth con estado de un solo uso', async () => {
  assert.equal(process.env.TEST_ALLOW_DESTRUCTIVE, '1', 'Usa una base de pruebas y TEST_ALLOW_DESTRUCTIVE=1')
  assert.ok(base && process.env.PGPORT)
  const pool = new pg.Pool()
  try {
    const admin = new Client(), seller = new Client(), anonymous = new Client()
    assert.equal((await anonymous.call('GET', 'admin/sheets')).status, 401)
    assert.equal((await seller.call('POST', 'auth/login', { role: 'seller', pin: process.env.SELLER_PIN })).status, 200)
    assert.equal((await seller.call('GET', 'admin/sheets')).status, 403)
    assert.equal((await seller.call('POST', 'admin/sheets/oauth/start')).status, 403)
    assert.equal((await admin.call('POST', 'auth/login', { role: 'admin', pin: '12345' })).status, 400)
    assert.equal((await admin.call('POST', 'auth/login', { role: 'admin', pin: 123456 })).status, 400)
    await pool.query('DELETE FROM login_attempts')
    for (let i = 0; i < 5; i++) assert.equal((await admin.call('POST', 'auth/login', { role: 'admin', pin: '999999' })).status, 401)
    assert.equal((await admin.call('POST', 'auth/login', { role: 'admin', pin: process.env.ADMIN_PIN })).status, 429)
    assert.equal((await pool.query('SELECT failures FROM login_attempts')).rows[0].failures, 5)
    await pool.query("UPDATE login_attempts SET expires_at=now()-interval '1 second'")
    assert.equal((await admin.call('POST', 'auth/login', { role: 'admin', pin: process.env.ADMIN_PIN })).status, 200)
    const saved = (await pool.query("SELECT credential_hash FROM sessions WHERE role='admin' ORDER BY created_at DESC LIMIT 1")).rows[0]
    assert.ok(saved.credential_hash && !saved.credential_hash.includes(process.env.ADMIN_PIN))
    const status = (await admin.call('GET', 'admin/sheets')).data
    assert.equal(status.status, 'authorization')
    assert.equal(status.oauthReady, true)
    assert.ok(!JSON.stringify(status).includes(process.env.GOOGLE_OAUTH_CLIENT_SECRET))
    const start = await admin.call('POST', 'admin/sheets/oauth/start')
    assert.equal(start.status, 200)
    assert.match(start.headers.get('set-cookie'), /HttpOnly.*SameSite=lax/i)
    const url = new URL(start.data.url)
    assert.equal(url.hostname, 'accounts.google.com')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), SHEETS_SCOPE)
    const callback = `admin/sheets/oauth/callback?error=access_denied&state=${url.searchParams.get('state')}`
    assert.equal((await anonymous.call('GET', callback)).status, 403)
    const finish = await admin.call('GET', callback)
    assert.equal(finish.status, 303)
    assert.match(finish.headers.get('location'), /google=denied/)
    assert.equal((await admin.call('GET', callback)).status, 403)
    const again = await admin.call('POST', 'admin/sheets/oauth/start')
    const state = new URL(again.data.url).searchParams.get('state')
    await admin.call('POST', 'auth/logout')
    assert.equal((await admin.call('GET', `admin/sheets/oauth/callback?error=access_denied&state=${state}`)).status, 403)
  } finally { await pool.end() }
})

test('copia consistente: cambios, anulaciones, reventa, concurrencia y recuperación', { timeout: 30000 }, async () => {
  assert.equal(process.env.TEST_ALLOW_DESTRUCTIVE, '1')
  const pool = new pg.Pool()
  let vendorId, participantId, saleId
  try {
    vendorId = (await pool.query("INSERT INTO vendors (name) VALUES ('Prueba Sheets') RETURNING id")).rows[0].id
    participantId = (await pool.query("INSERT INTO participants (name,phone,share_token) VALUES ('Prueba comprador','+593998887776',$1) RETURNING id", [randomUUID()])).rows[0].id
    saleId = (await pool.query("INSERT INTO sales (vendor_id,participant_id,request_id,payload_hash) VALUES ($1,$2,$3,'test') RETURNING id", [vendorId, participantId, randomUUID()])).rows[0].id
    await pool.query('INSERT INTO sale_items (sale_id,ticket_number,price_cents) SELECT $1,n,CASE WHEN n<825 THEN 150 ELSE 100 END FROM generate_series(800,849) n', [saleId])
    await pool.query('INSERT INTO google_connection (id,client_id,refresh_token_encrypted) VALUES (1,$1,$2)', [process.env.GOOGLE_OAUTH_CLIENT_ID, encryptToken('test-refresh-token')])
    let writes = [], fail = true
    const metadata = { sheets: [{ properties: { sheetId: 0, title: 'Ventas', gridProperties: { rowCount: 1000, columnCount: 10 } } }, { properties: { sheetId: 1, title: 'Resumen por vendedor', gridProperties: { rowCount: 20, columnCount: 5 } } }] }
    const transport = { getMetadata: async () => metadata, write: async (_id, requests) => { writes = requests.filter(r => r.updateCells).map(r => r.updateCells.rows.map(row => row.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue))); if (fail) throw { response: { status: 503, data: 'SECRET' } } } }
    const first = await syncOnce(pool, transport, 'test-spreadsheet', { force: true })
    assert.ok(first.error)
    assert.equal(writes[1].find(row => row[0] === 'Prueba Sheets')[4], 62.50)
    let stored = (await pool.query('SELECT * FROM sheet_sync')).rows[0]
    assert.notEqual(stored.revision, stored.synced_revision)
    assert.ok(!stored.last_error.includes('SECRET'))
    assert.equal((await syncOnce(pool, transport, 'test-spreadsheet')).skipped, 'idle')
    fail = false
    // A fresh connection pool represents a restarted worker; the remote write already happened.
    const restarted = new pg.Pool()
    try { assert.ok((await syncOnce(restarted, transport, 'test-spreadsheet', { force: true })).synced) } finally { await restarted.end() }
    assert.equal(new Set(writes[0].slice(1).map(row => row[0])).size, writes[0].length - 1)
    await pool.query('UPDATE sale_items SET canceled_at=now() WHERE sale_id=$1 AND ticket_number=800', [saleId])
    await pool.query('INSERT INTO sale_items (sale_id,ticket_number,price_cents) VALUES ($1,800,125)', [saleId])
    await pool.query("UPDATE participants SET name='Comprador corregido',phone='+593998887775' WHERE id=$1", [participantId])
    await syncOnce(pool, transport, 'test-spreadsheet', { force: true })
    const sameNumber = writes[0].filter(row => row[2] === '0800')
    assert.equal(sameNumber.length, 2)
    assert.equal(sameNumber[0][8], 'Anulado')
    assert.equal(sameNumber[1][8], 'Vendido')
    assert.equal(sameNumber[1][6], '+593998887775')
    assert.equal(writes[1].find(row => row[0] === 'Prueba Sheets')[4], 62.25)
    let release, entered
    const writing = new Promise(resolve => { entered = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    const slow = { ...transport, write: async (...args) => { entered(); await barrier; return transport.write(...args) } }
    const inFlight = syncOnce(pool, slow, 'test-spreadsheet', { force: true })
    await writing
    assert.equal((await syncOnce(pool, transport, 'test-spreadsheet', { force: true })).skipped, 'locked')
    await pool.query('UPDATE sale_items SET price_cents=200 WHERE sale_id=$1 AND ticket_number=801 AND canceled_at IS NULL', [saleId])
    release()
    await inFlight
    stored = (await pool.query('SELECT * FROM sheet_sync')).rows[0]
    assert.notEqual(stored.revision, stored.synced_revision, 'Una venta concurrente debe quedar pendiente')
    await syncOnce(pool, transport, 'test-spreadsheet', { force: true })
    assert.equal(writes[1].find(row => row[0] === 'Prueba Sheets')[4], 62.75)
    const before = (await pool.query('SELECT revision FROM sheet_sync')).rows[0].revision
    const connection = await pool.connect()
    try {
      await connection.query('BEGIN')
      await connection.query("UPDATE vendors SET name='Cambio revertido' WHERE id=$1", [vendorId])
      await connection.query('ROLLBACK')
      const snapshot = await readSnapshot(connection)
      assert.equal(snapshot.state.revision, before)
    } finally { connection.release() }
  } finally {
    if (saleId) { await pool.query('DELETE FROM sale_items WHERE sale_id=$1', [saleId]); await pool.query('DELETE FROM sales WHERE id=$1', [saleId]) }
    if (participantId) await pool.query('DELETE FROM participants WHERE id=$1', [participantId])
    if (vendorId) await pool.query('DELETE FROM vendors WHERE id=$1', [vendorId])
    await pool.query('DELETE FROM google_connection')
    await pool.end()
  }
})
