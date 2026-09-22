'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, CircleAlert, CloudUpload, Link2, RefreshCw, Sheet } from 'lucide-react'
import { api } from '@/lib/client'

type SheetsStatus = {
  configured: boolean; status: string; pending: boolean; connected: boolean; oauthReady: boolean;
  authMode: string; redirectUri: string | null; lastSyncedAt: string | null;
  nextAttemptAt: string | null; error: string | null; url: string | null;
}
const labels: Record<string, string> = { unconfigured: 'Configuración pendiente', authorization: 'Autoriza tu cuenta de Google', offline: 'Sincronizador desconectado', syncing: 'Copiando las ventas…', error: 'Esperando un reintento', pending: 'Cambios pendientes', synced: 'Todo al día' }

export function SheetsPanel() {
  const [data, setData] = useState<SheetsStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => { setData(await api<SheetsStatus>('admin/sheets')) }, [])
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('google')
    if (result === 'connected') setNotice('Google conectado. La primera copia comenzará automáticamente.')
    if (result === 'denied') setError('No se autorizó el acceso a Google. Puedes volver a intentarlo.')
    if (result === 'error') setError('No se pudo completar la autorización. Revisa el permiso de Google Sheets y vuelve a conectar.')
    refresh().catch(cause => setError((cause as Error).message))
    const timer = setInterval(() => refresh().catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [refresh])
  async function connect() {
    setBusy(true); setError('')
    try {
      const result = await api<{ url: string }>('admin/sheets/oauth/start', { method: 'POST' })
      window.location.assign(result.url)
    } catch (cause) { setError((cause as Error).message); setBusy(false) }
  }
  async function sync() {
    setBusy(true); setError(''); setNotice('')
    try { await api('admin/sheets/sync', { method: 'POST' }); setNotice('Sincronización solicitada. Los cambios se copiarán en breve.'); await refresh() }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="admin-section sheets-panel">
    <div className="section-heading"><h2>Tu copia en Google Sheets</h2><p>Consulta tus ventas y los totales de cada vendedor en una hoja privada.</p></div>
    <div className="card sheets-card">
      <div className="sheets-heading"><span className="round-icon mint"><Sheet size={25}/></span><div><span className="eyebrow">COPIA DE TUS VENTAS</span><h3>{data ? labels[data.status] : 'Consultando conexión…'}</h3></div>{data?.status === 'synced' && <Check className="sheets-check" aria-label="Sincronizado"/>}</div>
      <p>Cada boleto conserva su precio y comprador. Las correcciones y anulaciones se reflejan automáticamente, y puedes seguir vendiendo si se interrumpe la conexión.</p>
      <div className="sheets-details"><div><small>Última copia completada</small><strong>{data?.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : 'Todavía no se ha completado una copia'}</strong></div><div><small>Contenido de la hoja</small><strong>Ventas · Resumen por vendedor</strong></div></div>
      {data?.status === 'authorization' && <p className="sheets-hint"><Link2 size={18}/>Autoriza tu cuenta una vez para comenzar la copia automática.</p>}
      {data?.status === 'unconfigured' && <p className="sheets-hint"><CircleAlert size={18}/>Falta completar la configuración de Google en el servidor.</p>}
      {data?.status === 'offline' && <p className="sheets-hint"><CircleAlert size={18}/>Los cambios están guardados. Se copiarán cuando vuelva a conectarse el sincronizador.</p>}
      {data?.error && data.status === 'error' && <p className="error-message" role="status">{data.error}</p>}
      {data?.authMode === 'oauth' && data.redirectUri && !data.connected && <div className="sheets-redirect"><small>URI de redirección que debe estar autorizada en tu aplicación de Google</small><code>{data.redirectUri}</code></div>}
      <div className="sheets-actions">
        {data?.authMode === 'oauth' && <button className="button primary" onClick={connect} disabled={busy || !data.oauthReady || !data.configured}><Link2 size={17}/>{data.connected ? 'Volver a conectar Google' : 'Conectar Google'}</button>}
        <button className="button secondary" onClick={sync} disabled={busy || !data?.configured || !data?.connected || data.status === 'syncing'}><RefreshCw size={17}/>{busy ? 'Un momento…' : 'Sincronizar ahora'}</button>
        {data?.url && <a className="button soft" href={data.url} target="_blank" rel="noreferrer">Abrir hoja <ArrowUpRight size={17}/></a>}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="hint-success" role="status"><Check size={17}/>{notice}</p>}
    </div>
    <p className="sheets-footnote"><CloudUpload size={18}/>La app actualiza estas dos pestañas. Para hacer anotaciones propias, utiliza otra pestaña.</p>
  </section>
}
