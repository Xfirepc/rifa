import pg from 'pg'
import { createGoogleTransport } from './google-auth.mjs'
import { setTimeout as sleep } from 'node:timers/promises'
import { syncOnce } from './sheets-core.mjs'

const spreadsheetId = process.env.GOOGLE_SHEETS_ID
if (!spreadsheetId || !/^[\w-]+$/.test(spreadsheetId)) throw new Error('Configura GOOGLE_SHEETS_ID para iniciar el sincronizador.')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
const transport = createGoogleTransport(pool)
let stopping = false
const abort = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; abort.abort() })
// A heartbeat also runs during slow HTTP requests; it uses a separate DB connection.
const heartbeat = setInterval(() => pool.query('UPDATE sheet_sync SET heartbeat_at=now() WHERE id=1').catch(() => {}), 15_000)
try {
  while (!stopping) {
    try {
      const result = await syncOnce(pool, transport, spreadsheetId)
      if (result.error) console.error(result.error)
      if (result.synced) console.log(`Google Sheets: revisión ${result.synced} publicada.`)
      await pool.query('DELETE FROM login_attempts WHERE expires_at<now()')
    } catch { console.error('No fue posible consultar el estado de sincronización. Se reintentará.') }
    if (!stopping) await sleep(15_000, undefined, { signal: abort.signal }).catch(() => {})
  }
} finally { clearInterval(heartbeat); await pool.end() }
