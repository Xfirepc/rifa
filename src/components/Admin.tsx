'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, BarChart3, Check, Edit3, Gift, History, ImagePlus, LayoutGrid, Plus, Search, Settings2, Share2, Ticket, Trash2, Trophy, Users, Wallet, X } from 'lucide-react'
import { api, type Dashboard, type Item, type Prize, type Vendor, formatMoney, formatTicket, parseMoney, shareParticipant } from '@/lib/client'
import { SheetsPanel } from '@/components/SheetsPanel'
import { Live } from '@/components/Live'

type AdminTab = 'overview' | 'vendors' | 'prizes' | 'tickets' | 'draw' | 'activity' | 'sheets'

export function Admin() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<AdminTab>('overview')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [name, setName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCount, setNewCount] = useState(5)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => { const next = await api<Dashboard>('state'); setData(next); setName(current => current || next.raffle.name) }, [])
  useEffect(() => { if (new URLSearchParams(window.location.search).has('google')) setTab('sheets') }, [])
  useEffect(() => { refresh().catch(cause => setError((cause as Error).message)); const timer = setInterval(() => refresh().catch(() => {}), 7000); return () => clearInterval(timer) }, [refresh])
  async function action(work: () => Promise<unknown>, success = 'Cambios guardados.') {
    setBusy(true); setError(''); setMessage('')
    try { await work(); await refresh(); setMessage(success) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function addPrize(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      await api('admin/prizes', { method: 'POST', body: JSON.stringify({ title: newTitle, description: newDescription, drawCount: newCount }) })
      await refresh()
      setNewTitle(''); setNewDescription(''); setNewCount(5); setMessage('Premio agregado.')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  if (!data) return <div className="page-loader"><Ticket/><span>Preparando administración…</span></div>
  const sold = data.items.filter(item => !item.canceled_at)
  const total = sold.reduce((sum, item) => sum + item.price_cents, 0)
  const people = new Set(sold.map(item => item.participant_id)).size
  const filtered = data.items.filter(item => !item.canceled_at && (query.trim() === '' || `${item.ticket_number} ${formatTicket(item.ticket_number)} ${item.participant_name} ${item.phone} ${item.vendor_name}`.toLowerCase().includes(query.toLowerCase())))
  return <main className="content admin-page"><div className="dashboard-heading"><div><span className="eyebrow"><Settings2 size={15}/> PANEL DE ADMINISTRACIÓN</span><h1>Tu rifa, a tu manera <span>✦</span></h1><p>Todo lo que necesitas para organizarla en un solo lugar.</p></div><span className={`status-pill ${data.raffle.status}`}>{data.raffle.status === 'open' ? '● Ventas abiertas' : data.raffle.status === 'drawing' ? '● Sorteo en curso' : '● Rifa finalizada'}</span></div>
    <nav className="tabs admin-tabs" aria-label="Administración">{([['overview', <BarChart3 size={17}/>, 'Resumen'], ['vendors', <Users size={17}/>, 'Vendedores'], ['prizes', <Gift size={17}/>, 'Premios'], ['tickets', <Ticket size={17}/>, 'Boletos'], ['draw', <Trophy size={17}/>, 'Sorteo'], ['activity', <History size={17}/>, 'Actividad'], ['sheets', <Share2 size={17}/>, 'Google Sheets']] as const).map(([key, icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setError(''); setMessage('') }}>{icon}{label}</button>)}</nav>
    {error && <p className="error-message banner" role="alert">{error}</p>}{message && <p className="hint-success banner" role="status"><Check size={17}/>{message}</p>}
    {tab === 'overview' && <><div className="stats-grid admin-stats"><AdminStat icon={<Ticket/>} tone="violet" label="Boletos vendidos" value={String(sold.length)}/><AdminStat icon={<Wallet/>} tone="peach" label="Total vendido" value={formatMoney(total)}/><AdminStat icon={<Users/>} tone="mint" label="Participantes" value={String(people)}/><AdminStat icon={<LayoutGrid/>} tone="blue" label="Disponibles" value={String(1000 - sold.length)}/></div><div className="overview-grid"><section className="card overview-card"><div className="panel-heading"><div><span className="round-icon violet"><Settings2 size={20}/></span><div><h2>Datos de la rifa</h2><p>Personaliza el nombre que todos verán.</p></div></div></div><label className="field-label">Nombre de la rifa<input value={name} onChange={event => setName(event.target.value)} disabled={data.raffle.status !== 'open'}/></label><button className="button secondary" disabled={busy || data.raffle.status !== 'open'} onClick={() => action(() => api('admin/raffle', { method: 'PATCH', body: JSON.stringify({ name }) }))}>Guardar nombre</button></section><section className="card overview-card"><div className="panel-heading"><div><span className="round-icon mint"><Trophy size={20}/></span><div><h2>Preparar el sorteo</h2><p>{data.prizes.length} {data.prizes.length === 1 ? 'premio configurado' : 'premios configurados'}.</p></div></div></div><p>Al comenzar, se cerrarán las ventas. Podrás sacar cada número desde una pantalla animada.</p><button className="button primary" onClick={() => setTab('draw')}>Ir al sorteo <ArrowRight size={17}/></button></section></div><section className="card overview-card leaderboard"><div className="panel-heading"><div><span className="round-icon peach"><BarChart3 size={20}/></span><div><h2>Ventas por vendedor</h2><p>Boletos e importe al precio real de venta.</p></div></div></div>{data.vendors.length ? data.vendors.map(v => <div className="leader-row" key={v.id}><span className="avatar small">{v.name[0]?.toUpperCase()}</span><strong>{v.name}</strong><span>{v.sold_count} boletos</span><b>{formatMoney(v.total_cents)}</b></div>) : <div className="empty-mini">Aún no hay vendedores.</div>}</section></>}
    {tab === 'vendors' && <section className="admin-section"><div className="section-heading"><h2>Tu equipo de vendedores</h2><p>Los nuevos vendedores reciben 50 boletos de cupo. Puedes ajustarlo aquí.</p></div><div className="vendor-grid">{data.vendors.map(v => <VendorCard key={v.id} vendor={v} locked={data.raffle.status !== 'open'} busy={busy} action={action}/>)}</div>{!data.vendors.length && <div className="empty-card card"><Users size={33}/><h3>Sin vendedores todavía</h3><p>Compárteles el PIN para que se registren.</p></div>}</section>}
    {tab === 'prizes' && <section className="admin-section"><div className="section-heading"><h2>Premios de la rifa</h2><p>El orden define la secuencia del sorteo. Cada premio tendrá un ganador.</p></div><div className="prize-admin-grid">{data.prizes.map((p, index) => <PrizeCard key={p.id} prize={p} index={index} raffleStatus={data.raffle.status} busy={busy} action={action}/>)}</div>{data.raffle.status === 'open' && <form className="card add-prize" onSubmit={addPrize}><span className="round-icon mint"><Plus size={22}/></span><div><h3>Agregar premio</h3><p>Puedes añadir una imagen después de crearlo.</p></div><label>Título<input placeholder="Ej. Canasta sorpresa" minLength={2} maxLength={100} value={newTitle} onChange={event => setNewTitle(event.target.value)} required/></label><label>Descripción<input placeholder="Un regalo especial…" value={newDescription} onChange={event => setNewDescription(event.target.value)}/></label><label>Extracciones<input type="number" min={1} max={1000} value={newCount} onChange={event => setNewCount(Number(event.target.value))} required/></label><button className="button primary" disabled={busy}><Plus size={17}/> Agregar premio</button></form>}</section>}
    {tab === 'tickets' && <section className="admin-section"><div className="section-heading"><h2>Boletos y participantes</h2><p>Busca un número o comprador. Las correcciones se cierran al iniciar el sorteo.</p></div><div className="table-search"><Search size={19}/><input placeholder="Buscar número, nombre, teléfono o vendedor" value={query} onChange={event => setQuery(event.target.value)}/></div><div className="card table-wrap"><table><thead><tr><th>Boleto</th><th>Participante</th><th>Vendedor</th><th>Precio</th><th></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><span className="number-tag">#{formatTicket(item.ticket_number)}</span></td><td><strong>{item.participant_name}</strong><small>{item.phone}</small></td><td>{item.vendor_name}</td><td>{formatMoney(item.price_cents)}</td><td><button className="icon-button" aria-label={`Editar boleto ${item.ticket_number}`} onClick={() => setEditing(item)}><Edit3 size={17}/></button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-mini">No se encontraron boletos.</div>}</div></section>}
    {tab === 'draw' && <Live admin/>}
    {tab === 'sheets' && <SheetsPanel/>}
    {tab === 'activity' && <AuditPanel/>}
    {editing && <TicketEditor key={editing.id} item={editing} closed={data.raffle.status !== 'open'} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }}/>}
  </main>
}

type AuditEntry = { id: number; action: string; details: Record<string, unknown>; created_at: string; actor_role: string; actor_name: string | null }

function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<AuditEntry[]>('admin/audit').then(setEntries).catch(cause => setError((cause as Error).message)) }, [])
  return <section className="admin-section"><div className="section-heading"><h2>Actividad de la rifa</h2><p>Registro de ventas, correcciones y extracciones recientes.</p></div>{error && <p className="error-message">{error}</p>}<div className="card audit-list">{entries?.length ? entries.map(entry => <div className="audit-entry" key={entry.id}><span className="round-icon violet"><History size={17}/></span><div><strong>{auditDescription(entry)}</strong><small>{entry.actor_role === 'admin' ? 'Administrador' : entry.actor_name ?? 'Vendedor'} · {new Date(entry.created_at).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</small></div></div>) : <div className="empty-mini">{entries ? 'Aún no hay actividad.' : 'Cargando actividad…'}</div>}</div></section>
}

function auditDescription(entry: AuditEntry) {
  const d = entry.details
  switch (entry.action) {
    case 'vendor.created': return `Se registró ${d.name}`
    case 'vendor.updated': return `Se actualizaron los datos del vendedor #${d.vendorId}`
    case 'sale.created': return `Se registró una venta de ${Array.isArray(d.numbers) ? d.numbers.length : 1} boleto(s)`
    case 'sale.reassigned': return `Se reasignó la compra #${d.saleId}`
    case 'item.price_updated': return d.fromCents !== undefined ? `Precio del boleto #${formatTicket(Number(d.number))}: ${formatMoney(Number(d.fromCents))} → ${formatMoney(Number(d.toCents))}` : `Se corrigió el precio de un boleto`
    case 'item.canceled': return `Se anuló el boleto #${formatTicket(Number(d.number))}`
    case 'participant.updated': return `Se corrigieron los datos del participante #${d.participantId}`
    case 'participant.token_renewed': return `Se renovó el enlace del participante #${d.participantId}`
    case 'prize.created': return 'Se agregó un premio'
    case 'prize.updated': return 'Se actualizó un premio'
    case 'prize.deleted': return 'Se eliminó un premio'
    case 'raffle.started': return `Comenzó el sorteo con ${d.soldCount} boletos vendidos`
    case 'raffle.exhausted': return 'Finalizó la rifa sin más boletos elegibles'
    case 'draw.extracted': return `${d.kind === 'winner' ? 'Ganó' : 'Se eliminó'} el boleto #${formatTicket(Number(d.ticketNumber))} en el premio #${d.prizeId}`
    default: return entry.action
  }
}

function AdminStat({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: string }) { return <div className={`stat-card ${tone}`}><span className="stat-icon">{icon}</span><span>{label}</span><strong>{value}</strong></div> }

function VendorCard({ vendor, locked, busy, action }: { vendor: Vendor; locked: boolean; busy: boolean; action: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [name, setName] = useState(vendor.name)
  const [quota, setQuota] = useState(vendor.quota)
  return <article className="card vendor-card"><div className="vendor-top"><span className="avatar">{vendor.name[0]?.toUpperCase()}</span><span className={`badge ${vendor.active ? 'positive' : ''}`}>{vendor.active ? 'Activo' : 'Pausado'}</span></div><label>Nombre<input value={name} onChange={event => setName(event.target.value)} disabled={locked}/></label><div className="vendor-metrics"><span><strong>{vendor.sold_count}</strong> vendidos</span><span><strong>{formatMoney(vendor.total_cents)}</strong> total</span></div><label>Cupo de boletos<input type="number" min={vendor.sold_count} max={1000} value={quota} onChange={event => setQuota(Number(event.target.value))} disabled={locked}/></label><div className="vendor-actions"><button className="button secondary" disabled={busy || locked} onClick={() => action(() => api(`admin/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify({ name, quota }) }))}>Guardar cambios</button><button className="text-button" disabled={busy || locked} onClick={() => action(() => api(`admin/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify({ active: !vendor.active }) }), vendor.active ? 'Vendedor pausado.' : 'Vendedor activado.')}>{vendor.active ? 'Pausar' : 'Activar'}</button></div></article>
}

function PrizeCard({ prize, index, raffleStatus, busy, action }: { prize: Prize; index: number; raffleStatus: string; busy: boolean; action: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [title, setTitle] = useState(prize.title)
  const [description, setDescription] = useState(prize.description)
  const [imagePath, setImagePath] = useState<string | null>(prize.imagePath)
  const [drawCount, setDrawCount] = useState(prize.drawCount)
  const [sortOrder, setSortOrder] = useState(prize.sortOrder)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const pending = prize.state === 'pending'
  const editable = raffleStatus === 'open' && pending
  async function upload(file: File) {
    setUploading(true); setUploadError('')
    try { const body = new FormData(); body.append('file', file); const result = await api<{ path: string }>('admin/upload', { method: 'POST', body }); setImagePath(result.path) }
    catch (cause) { setUploadError((cause as Error).message) }
    finally { setUploading(false) }
  }
  return <article className="card prize-editor"><div className="prize-editor-image">{imagePath ? <img src={imagePath} alt=""/> : <span><Gift size={36}/></span>}{editable && <label className="image-upload"><ImagePlus size={17}/>{uploading ? 'Subiendo…' : 'Elegir imagen'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) upload(file) }}/></label>}</div><div className="prize-editor-body"><div className="prize-caption"><span>PREMIO {String(index + 1).padStart(2, '0')}</span><span className={`badge ${prize.state === 'awarded' ? 'positive' : ''}`}>{prize.state === 'awarded' ? 'Adjudicado' : prize.state === 'active' ? 'En curso' : prize.state === 'unawarded' ? 'Sin adjudicar' : 'Pendiente'}</span></div><label>Título<input value={title} onChange={event => setTitle(event.target.value)} disabled={!editable}/></label><label>Descripción<textarea value={description} onChange={event => setDescription(event.target.value)} rows={2} disabled={!editable}/></label>{editable && imagePath && <button className="text-button" onClick={() => setImagePath(null)}>Quitar imagen</button>}<div className="prize-fields"><label>Extracciones<input type="number" min={1} max={1000} value={drawCount} onChange={event => setDrawCount(Number(event.target.value))} disabled={!pending}/></label><label>Orden<input type="number" min={1} max={1000} value={sortOrder} onChange={event => setSortOrder(Number(event.target.value))} disabled={!editable}/></label></div>{uploadError && <p className="error-message">{uploadError}</p>}{pending && <div className="prize-actions"><button className="button secondary" disabled={busy || uploading} onClick={() => action(() => api(`admin/prizes/${prize.id}`, { method: 'PATCH', body: JSON.stringify(raffleStatus === 'open' ? { title, description, imagePath, drawCount, sortOrder } : { drawCount }) }))}>Guardar premio</button>{editable && <button className="icon-button danger" title="Eliminar premio" aria-label={`Eliminar ${prize.title}`} disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar el premio «${prize.title}»?`)) action(() => api(`admin/prizes/${prize.id}`, { method: 'DELETE' }), 'Premio eliminado.') }}><Trash2 size={17}/></button>}</div>}</div></article>
}

function TicketEditor({ item, closed, onClose, onSaved }: { item: Item; closed: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [priceText, setPriceText] = useState((item.price_cents / 100).toFixed(2))
  const [name, setName] = useState(item.participant_name)
  const [phone, setPhone] = useState(item.phone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function run(work: () => Promise<unknown>, text: string) { setBusy(true); setError(''); try { await work(); setNotice(text); await onSaved() } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } }
  async function share() { try { await shareParticipant(item.share_token, item.participant_name); setNotice('Enlace copiado o compartido.') } catch (cause) { setError((cause as Error).message) } }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="modal-card card" role="dialog" aria-modal="true" aria-label={`Editar boleto ${item.ticket_number}`}><div className="modal-heading"><div><span className="eyebrow">BOLETO #{formatTicket(item.ticket_number)}</span><h2>Detalles de la venta</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={21}/></button></div><p className="modal-muted">Venta #{item.sale_id} · Vendedor: {item.vendor_name}</p><label className="field-label">Precio de este boleto<input inputMode="decimal" value={priceText} onChange={event => setPriceText(event.target.value)} disabled={closed}/></label><button className="button secondary full" disabled={busy || closed || !parseMoney(priceText)} onClick={() => run(() => api(`admin/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ priceCents: parseMoney(priceText) }) }), 'Precio actualizado.')}>Guardar precio</button><div className="modal-separator"/><h3>Participante</h3><p className="modal-muted">Cambiar estos datos actualizará todas sus compras. Para mover solo la compra #{item.sale_id} a otra persona, usa «Reasignar compra».</p><label className="field-label">Nombre<input value={name} onChange={event => setName(event.target.value)} disabled={closed}/></label><label className="field-label">Teléfono<input value={phone} onChange={event => setPhone(event.target.value)} disabled={closed}/></label><div className="modal-actions"><button className="button secondary" disabled={busy || closed} onClick={() => run(() => api(`admin/participants/${item.participant_id}`, { method: 'PATCH', body: JSON.stringify({ name, phone }) }), 'Participante actualizado.')}>Actualizar datos</button><button className="button soft" disabled={busy || closed} onClick={() => run(() => api(`admin/sales/${item.sale_id}/reassign`, { method: 'POST', body: JSON.stringify({ name, phone }) }), 'Compra reasignada.')}>Reasignar compra</button></div><div className="modal-separator"/><div className="modal-actions"><button className="button soft" onClick={share}><Share2 size={17}/> Compartir enlace</button><button className="text-button" disabled={busy} onClick={() => run(() => api(`admin/participants/${item.participant_id}/token`, { method: 'POST' }), 'Enlace renovado. El anterior ya no funciona.')}>Renovar enlace</button></div>{!closed && <button className="button danger-button full" disabled={busy} onClick={() => { if (window.confirm(`¿Anular el boleto #${formatTicket(item.ticket_number)}? El número volverá a estar disponible.`)) run(() => api(`admin/items/${item.id}`, { method: 'DELETE' }), 'Boleto anulado.') }}><Trash2 size={17}/> Anular este boleto</button>}{error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="hint-success"><Check size={17}/>{notice}</p>}</div></div>
}
