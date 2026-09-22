export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
export const SHEETS_LOCK = 74931026
export const SHEET_TITLES = ['Ventas', 'Resumen por vendedor']

export async function readSnapshot(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const { rows: [state] } = await client.query('SELECT * FROM sheet_sync WHERE id=1')
    const { rows: items } = await client.query(`SELECT i.id,i.sale_id,i.ticket_number,i.price_cents,i.canceled_at,
      s.created_at,v.name AS vendor_name,p.name AS participant_name,p.phone
      FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN vendors v ON v.id=s.vendor_id
      JOIN participants p ON p.id=s.participant_id ORDER BY i.id`)
    const { rows: vendors } = await client.query(`SELECT v.id,v.name,v.quota,
      count(i.id)::integer AS sold_count,coalesce(sum(i.price_cents),0)::text AS total_cents
      FROM vendors v LEFT JOIN sales s ON s.vendor_id=v.id
      LEFT JOIN sale_items i ON i.sale_id=s.id AND i.canceled_at IS NULL
      GROUP BY v.id ORDER BY lower(v.name),v.id`)
    await client.query('COMMIT')
    return { state, items, vendors }
  } catch (error) { await client.query('ROLLBACK'); throw error }
}

function date(value) {
  return value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'America/Guayaquil', hour12: false }) : ''
}

export function sheetData(snapshot) {
  return [
    {
      title: SHEET_TITLES[0], moneyColumn: 7,
      widths: [110, 110, 100, 190, 220, 220, 165, 145, 130, 190],
      rows: [
        ['ID detalle', 'ID compra', 'Boleto', 'Fecha de venta (Ecuador)', 'Vendedor', 'Participante', 'Teléfono', 'Precio USD', 'Estado', 'Fecha de anulación'],
        ...snapshot.items.map(item => [String(item.id), String(item.sale_id), String(item.ticket_number).padStart(4, '0'), date(item.created_at), item.vendor_name, item.participant_name, item.phone, item.price_cents / 100, item.canceled_at ? 'Anulado' : 'Vendido', date(item.canceled_at)]),
      ],
    },
    {
      title: SHEET_TITLES[1], moneyColumn: 4, widths: [240, 110, 160, 160, 180],
      rows: [
        ['Vendedor', 'Cupo', 'Boletos vendidos', 'Cupo disponible', 'Total vendido USD'],
        ...snapshot.vendors.map(v => [v.name, v.quota, v.sold_count, Math.max(0, v.quota - v.sold_count), Number(v.total_cents) / 100]),
      ],
    },
  ]
}

// Replace values, never append: retrying a successful-but-unacknowledged write is safe.
// Each cell has an explicit type, so names/phones starting with '=' or '+' are not formulas.
export function buildSheetsRequests(snapshot, metadata) {
  const requests = []
  const usedIds = new Set((metadata.sheets ?? []).map(s => s.properties.sheetId))
  for (const data of sheetData(snapshot)) {
    const existing = (metadata.sheets ?? []).find(s => s.properties.title === data.title)?.properties
    let sheetId = existing?.sheetId
    if (sheetId === undefined) {
      sheetId = 17001
      while (usedIds.has(sheetId)) sheetId++
      usedIds.add(sheetId)
      requests.push({ addSheet: { properties: { sheetId, title: data.title, gridProperties: { rowCount: Math.max(data.rows.length, 2), columnCount: data.widths.length } } } })
    }
    const rowCount = Math.max(existing?.gridProperties?.rowCount ?? 2, data.rows.length, 2)
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount, columnCount: Math.max(existing?.gridProperties?.columnCount ?? 0, data.widths.length), frozenRowCount: 1 } }, fields: 'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount' } })
    const range = { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: data.widths.length }
    requests.push({ repeatCell: { range, cell: {}, fields: 'userEnteredValue' } })
    requests.push({ updateCells: {
      range: { ...range, endRowIndex: data.rows.length },
      rows: data.rows.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) })),
      fields: 'userEnteredValue',
    } })
    requests.push({ repeatCell: { range: { ...range, endRowIndex: data.rows.length }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 11, foregroundColor: { red: .13, green: .15, blue: .23 } }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy' } })
    requests.push({ repeatCell: { range: { ...range, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: .90, green: .87, blue: .98 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } })
    if (data.rows.length > 1) requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: data.rows.length, startColumnIndex: data.moneyColumn, endColumnIndex: data.moneyColumn + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"USD "#,##0.00' } } }, fields: 'userEnteredFormat.numberFormat' } })
    requests.push({ setBasicFilter: { filter: { range: { ...range, endRowIndex: Math.max(2, data.rows.length) } } } })
    data.widths.forEach((pixelSize, index) => requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize }, fields: 'pixelSize' } }))
  }
  return requests
}

export function retryDelay(failures, random = Math.random) {
  return Math.min(300_000, 15_000 * 2 ** Math.min(Math.max(failures - 1, 0), 5) + Math.floor(random() * 1000))
}

export function safeSyncError(error) {
  // Do not persist OAuth credentials, HTTP request objects, tokens or response bodies.
  const status = Number(error?.response?.status ?? error?.status ?? 0)
  if (error?.code === 'GOOGLE_NOT_CONNECTED') return 'Conecta Google desde el panel de administración para iniciar la copia.'
  if (error?.code === 'GOOGLE_CONFIG') return 'Revisa la configuración de la aplicación de Google en el servidor.'
  if (error?.code === 'ENOENT') return 'No se encontró el archivo de credenciales de Google.'
  if (status === 401 || error?.response?.data?.error === 'invalid_grant') return 'La autorización de Google venció o fue revocada. Vuelve a conectar la cuenta.'
  if (status === 403) return 'Google denegó el acceso. Revisa los permisos de la hoja y que Sheets API esté habilitada.'
  if (status === 404) return 'No se encontró la hoja. Revisa su identificador y los permisos.'
  if (status === 429) return 'Google limitó las solicitudes. Se reintentará automáticamente.'
  if (status === 400) return 'Google rechazó la configuración o el contenido de la hoja. Revisa la conexión.'
  return 'No fue posible sincronizar con Google. Se reintentará automáticamente.'
}

export async function syncOnce(pool, transport, spreadsheetId, { force = false } = {}) {
  const client = await pool.connect()
  let locked = false
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SHEETS_LOCK])
    locked = lock.rows[0].locked
    if (!locked) return { skipped: 'locked' }
    await client.query('UPDATE sheet_sync SET heartbeat_at=now() WHERE id=1')
    const { rows: [state] } = await client.query(`SELECT *,next_attempt_at<=now() AS due,
      last_synced_at IS NULL OR last_synced_at<now()-interval '10 minutes' AS reconcile FROM sheet_sync WHERE id=1`)
    const targetChanged = state.spreadsheet_id !== spreadsheetId
    if (!force && (!state.due || (!targetChanged && state.revision === state.synced_revision && !state.reconcile))) return { skipped: 'idle' }
    await client.query('UPDATE sheet_sync SET syncing=true,last_attempt_at=now(),heartbeat_at=now() WHERE id=1')
    try {
      const snapshot = await readSnapshot(client)
      const metadata = await transport.getMetadata(spreadsheetId)
      await transport.write(spreadsheetId, buildSheetsRequests(snapshot, metadata))
      await client.query(`UPDATE sheet_sync SET synced_revision=$1,spreadsheet_id=$2,last_synced_at=now(),
        next_attempt_at=now(),syncing=false,failures=0,last_error=NULL,heartbeat_at=now() WHERE id=1`, [snapshot.state.revision, spreadsheetId])
      return { synced: snapshot.state.revision }
    } catch (error) {
      const failures = state.failures + 1
      // Allow an ambiguous HTTP timeout to finish at Google before sending a newer snapshot.
      const timeout = ['ETIMEDOUT', 'ECONNRESET', 'ABORT_ERR'].includes(error?.code) || error?.name === 'AbortError'
      const delay = timeout ? 300_000 : retryDelay(failures)
      const message = safeSyncError(error)
      await client.query(`UPDATE sheet_sync SET syncing=false,failures=$1,last_error=$2,
        next_attempt_at=now()+($3::integer * interval '1 millisecond'),heartbeat_at=now() WHERE id=1`, [failures, message, delay])
      return { error: message }
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [SHEETS_LOCK]) }
    finally { client.release() }
  }
}
