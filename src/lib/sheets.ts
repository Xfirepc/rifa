import { pool } from '@/lib/db'
import { assert } from '@/lib/common'
import { oauthConfigured } from '../../scripts/google-auth.mjs'

export async function getSheetsStatus() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID ?? ''
  const enabled = process.env.GOOGLE_SHEETS_ENABLED === 'true'
  const { rows: [state] } = await pool.query(`SELECT *,heartbeat_at>now()-interval '60 seconds' AS online FROM sheet_sync WHERE id=1`)
  const configured = enabled && /^[\w-]+$/.test(spreadsheetId)
  const authMode = process.env.GOOGLE_AUTH_MODE === 'service_account' ? 'service_account' : 'oauth'
  const oauthReady = oauthConfigured()
  const { rows: [connection] } = await pool.query('SELECT client_id FROM google_connection WHERE id=1')
  const connected = authMode === 'service_account' || Boolean(connection && connection.client_id === process.env.GOOGLE_OAUTH_CLIENT_ID)
  const pending = state.revision !== state.synced_revision || state.spreadsheet_id !== spreadsheetId
  const status = !configured || (authMode === 'oauth' && !oauthReady) ? 'unconfigured' : !connected ? 'authorization' : !state.online ? 'offline' : state.syncing ? 'syncing' : state.last_error ? 'error' : pending ? 'pending' : 'synced'
  return { configured, status, pending, connected, oauthReady, authMode, redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? null, lastSyncedAt: state.spreadsheet_id === spreadsheetId ? state.last_synced_at : null, nextAttemptAt: state.next_attempt_at, error: state.last_error, url: /^[\w-]+$/.test(spreadsheetId) ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null }
}

export async function requestSheetsSync() {
  const status = await getSheetsStatus()
  assert(status.configured, 409, 'Primero configura la conexión con Google Sheets.')
  assert(status.connected, 409, 'Conecta tu cuenta de Google para iniciar la sincronización.')
  await pool.query('UPDATE sheet_sync SET revision=revision+1,next_attempt_at=now() WHERE id=1')
  return { queued: true }
}
