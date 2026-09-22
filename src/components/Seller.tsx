'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleHelp, LayoutGrid, MessageCircle, Plus, Search, Share2, ShoppingBag, Ticket, UserRound, Users, Wallet } from 'lucide-react'
import { api, type Dashboard, type Item, formatMoney, formatTicket, openWhatsApp, parseMoney, shareParticipant } from '@/lib/client'

export function Seller({ selectedVendorId, onVendorSelected }: { selectedVendorId: number | null; onVendorSelected: (id: number) => void }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [vendors, setVendors] = useState<{ id: number; name: string; quota: number }[]>([])
  const [newName, setNewName] = useState('')
  const [tab, setTab] = useState<'sell' | 'sales'>('sell')
  const [page, setPage] = useState(0)
  const [quick, setQuick] = useState('')
  const [batchPrice, setBatchPrice] = useState('')
  const [selected, setSelected] = useState<Record<number, number>>({})
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({})
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [knownBuyer, setKnownBuyer] = useState(false)
  const [success, setSuccess] = useState<{ shareToken: string; name: string; phone: string; count: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const requestId = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (selectedVendorId) setData(await api<Dashboard>('state'))
    else setVendors(await api<typeof vendors>('vendors'))
  }, [selectedVendorId])
  useEffect(() => {
    refresh().catch(cause => setError((cause as Error).message))
    const timer = setInterval(() => refresh().catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    const last = data?.vendors.find(v => v.id === selectedVendorId)?.last_price_cents
    if (last && !batchPrice) setBatchPrice((last / 100).toFixed(2))
  }, [data, selectedVendorId, batchPrice])

  async function choose(id: number) {
    setBusy(true); setError('')
    try { await api('auth/select', { method: 'POST', body: JSON.stringify({ vendorId: id }) }); onVendorSelected(id) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function register(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await api<{ id: number }>('vendors', { method: 'POST', body: JSON.stringify({ name: newName }) }); onVendorSelected(result.id) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  if (!selectedVendorId) return <main className="content pick-profile">
    <div className="section-heading centered"><span className="eyebrow"><Users size={15}/> EQUIPO DE VENTA</span><h1>¿Quién está vendiendo hoy?</h1><p>Selecciona tu nombre o regístrate para comenzar.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="profile-grid">{vendors.map(v => <button key={v.id} className="profile-card" onClick={() => choose(v.id)} disabled={busy}><span className="avatar">{v.name[0]?.toUpperCase()}</span><strong>{v.name}</strong><small>Cupo de {v.quota} boletos</small><ArrowRight size={18}/></button>)}</div>
    <form className="register-card card" onSubmit={register}><span className="round-icon mint"><Plus size={20}/></span><div><h2>¿Eres nuevo aquí?</h2><p>Tu cupo inicial será de 50 boletos.</p></div><input aria-label="Tu nombre" placeholder="Escribe tu nombre" minLength={2} maxLength={100} value={newName} onChange={event => setNewName(event.target.value)} required/><button className="button primary" disabled={busy}>Registrarme <ArrowRight size={17}/></button></form>
  </main>

  const vendor = data?.vendors.find(v => v.id === selectedVendorId)
  if (!data || !vendor) return <div className="page-loader"><Ticket/><span>Cargando boletos…</span></div>
  const active = data.items.filter(item => !item.canceled_at)
  const occupied = new Set(data.occupiedNumbers)
  const selectedNumbers = Object.keys(selected).map(Number).sort((a, b) => a - b)
  const selectedTotal = selectedNumbers.reduce((sum, number) => sum + selected[number], 0)
  const remaining = Math.max(0, vendor.quota - vendor.sold_count)
  const canSell = data.raffle.status === 'open' && vendor.active
  const groups = Object.values(active.reduce<Record<number, Item[]>>((acc, item) => { (acc[item.sale_id] ??= []).push(item); return acc }, {})).sort((a, b) => b[0].sale_id - a[0].sale_id)

  function touch() { requestId.current = null; setSuccess(null); setError('') }
  function toggleTicket(number: number) {
    if (occupied.has(number)) return
    if (selected[number] !== undefined) { const next = { ...selected }; delete next[number]; setSelected(next); const drafts = { ...priceDrafts }; delete drafts[number]; setPriceDrafts(drafts); touch(); return }
    if (selectedNumbers.length >= remaining) { setError('Esta selección supera tu cupo disponible.'); return }
    const cents = parseMoney(batchPrice)
    if (!cents) { setError('Escribe primero un precio válido en USD.'); return }
    setSelected({ ...selected, [number]: cents }); touch()
  }
  function addQuick() {
    const cents = parseMoney(batchPrice)
    if (!cents) { setError('Escribe primero un precio válido en USD.'); return }
    const entries = quick.split(',').map(x => x.trim()).filter(Boolean)
    const numbers: number[] = []
    for (const entry of entries) {
      const match = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(entry)
      if (!match) { setError('Usa números separados por coma o rangos como 100-109.'); return }
      const start = Number(match[1]); const end = Number(match[2] ?? match[1])
      if (start < 1 || end > 1000 || start > end || end - start > 999) { setError('Los números deben estar entre 1 y 1000.'); return }
      for (let number = start; number <= end; number++) numbers.push(number)
    }
    const unique = [...new Set(numbers)]
    const unavailable = unique.filter(number => occupied.has(number))
    if (unavailable.length) { setError(`Ya se vendieron: ${unavailable.map(formatTicket).join(', ')}.`); return }
    if (new Set([...selectedNumbers, ...unique]).size > remaining) { setError('Esta selección supera tu cupo disponible.'); return }
    setSelected(Object.fromEntries([...Object.entries(selected).map(([n, p]) => [Number(n), p]), ...unique.map(n => [n, cents])]))
    setQuick(''); touch()
  }
  async function lookup() {
    if (!buyerPhone.trim()) return
    try { const found = await api<{ name: string; share_token: string } | null>(`participants/lookup?phone=${encodeURIComponent(buyerPhone)}`); if (found) { setBuyerName(found.name); setKnownBuyer(true) } else setKnownBuyer(false) }
    catch { setKnownBuyer(false) }
  }
  async function submitSale(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (!canSell || !selectedNumbers.length) { setError('Selecciona al menos un boleto disponible.'); return }
    if (selectedNumbers.some(number => !Number.isInteger(selected[number]) || selected[number] < 1)) { setError('Revisa los precios de los boletos seleccionados.'); return }
    setBusy(true)
    requestId.current ??= crypto.randomUUID()
    try {
      const response = await api<{ saleId: number; shareToken: string }>('sales', { method: 'POST', body: JSON.stringify({
        requestId: requestId.current,
        participant: { name: buyerName, phone: buyerPhone },
        items: selectedNumbers.map(number => ({ number, priceCents: selected[number] })),
      }) })
      setSuccess({ shareToken: response.shareToken, name: buyerName, phone: buyerPhone, count: selectedNumbers.length })
      setSelected({}); setBuyerName(''); setBuyerPhone(''); setKnownBuyer(false); requestId.current = null
      await refresh()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) { setError((cause as Error).message); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function share(token: string, name: string) {
    try { await shareParticipant(token, name); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch (cause) { setError((cause as Error).message) }
  }

  return <main className="content seller-page">
    <div className="dashboard-heading"><div><span className="eyebrow"><SparkleMark/> ESPACIO DE VENTA</span><h1>¡Hola, {vendor.name.split(' ')[0]}! <span>👋</span></h1><p>Hoy puedes acercar a alguien más a un gran premio.</p></div><button className="profile-switch" onClick={() => onVendorSelected(0)}><span className="avatar small">{vendor.name[0].toUpperCase()}</span><span>{vendor.name}<small>Cambiar perfil</small></span><ChevronRight size={17}/></button></div>
    {data.raffle.status !== 'open' && <div className="notice dark"><CircleHelp size={19}/> Las ventas están cerradas porque comenzó el sorteo. <a href="/live">Ver resultados</a></div>}
    <div className="stats-grid"><Stat icon={<Ticket/>} label="Mis boletos vendidos" value={String(vendor.sold_count)} tone="violet"/><Stat icon={<LayoutGrid/>} label="Cupo disponible" value={String(remaining)} tone="mint"/><Stat icon={<Wallet/>} label="Total vendido" value={formatMoney(vendor.total_cents)} tone="peach"/></div>
    <div className="tabs"><button className={tab === 'sell' ? 'active' : ''} onClick={() => setTab('sell')}><ShoppingBag size={18}/> Vender boletos</button><button className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}><Users size={18}/> Mis ventas <span className="tab-count">{groups.length}</span></button></div>
    {error && <p className="error-message banner" role="alert">{error}</p>}
    {success && <div className="success-banner"><span className="round-icon mint"><Check size={20}/></span><div><strong>¡Venta registrada!</strong><p>{success.count} {success.count === 1 ? 'boleto quedó' : 'boletos quedaron'} a nombre de {success.name}.</p></div><button className="button soft" onClick={() => openWhatsApp(success.shareToken, success.phone)}><MessageCircle size={17}/> WhatsApp</button><button className="button secondary" onClick={() => share(success.shareToken, success.name)}><Share2 size={17}/> {copied ? 'Enlace copiado' : 'Compartir'}</button></div>}
    {tab === 'sell' ? <form onSubmit={submitSale} className="sale-layout">
      <section className="card ticket-panel"><div className="panel-heading"><div><span className="step-dot">1</span><div><h2>Elige los números</h2><p>{1000 - occupied.size} disponibles de 1,000</p></div></div><span className="legend"><i/> Disponible <i/> Vendido <i/> Elegido</span></div>
        <div className="ticket-controls"><label>Precio para nuevos boletos <div className="money-input"><span>$</span><input inputMode="decimal" placeholder="1.00" value={batchPrice} onChange={event => setBatchPrice(event.target.value)} disabled={!canSell}/><span>USD</span></div></label><button type="button" className="button soft" onClick={() => { const cents = parseMoney(batchPrice); if (!cents) { setError('Introduce un precio válido.'); return }; setSelected(Object.fromEntries(selectedNumbers.map(number => [number, cents]))); setPriceDrafts({}); touch() }} disabled={!selectedNumbers.length || !canSell}>Aplicar a elegidos</button></div>
        <div className="quick-select" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addQuick() } }}><Search size={18}/><input aria-label="Seleccionar números o rangos" placeholder="Escribe 7, 15, 100-109" value={quick} onChange={event => setQuick(event.target.value)} disabled={!canSell}/><button type="button" onClick={addQuick} disabled={!canSell}>Agregar</button></div>
        <div className="ticket-grid" aria-label={`Boletos del ${page * 100 + 1} al ${(page + 1) * 100}`}>{Array.from({ length: 100 }, (_, i) => page * 100 + i + 1).map(number => <button key={number} type="button" className={`ticket-cell ${occupied.has(number) ? 'sold' : selected[number] !== undefined ? 'selected' : ''}`} disabled={occupied.has(number) || !canSell} aria-label={`Boleto ${number}${occupied.has(number) ? ', vendido' : selected[number] !== undefined ? ', seleccionado' : ', disponible'}`} aria-pressed={selected[number] !== undefined} onClick={() => toggleTicket(number)}>{formatTicket(number)}</button>)}</div>
        <div className="pagination"><button type="button" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}><ChevronLeft size={18}/> Anterior</button><span>{page + 1} / 10</span><button type="button" onClick={() => setPage(Math.min(9, page + 1))} disabled={page === 9}>Siguiente <ChevronRight size={18}/></button></div>
      </section>
      <aside className="sale-sidebar"><section className="card buyer-panel"><div className="panel-heading"><div><span className="step-dot">2</span><div><h2>¿Quién compra?</h2><p>Un comprador para todos los números elegidos.</p></div></div></div><label className="field-label">Teléfono del participante<input type="tel" placeholder="0991234567 o +593…" value={buyerPhone} onChange={event => { setBuyerPhone(event.target.value); setKnownBuyer(false); touch() }} onBlur={lookup} required disabled={!canSell}/></label><label className="field-label">Nombre completo<input placeholder="Nombre y apellido" value={buyerName} onChange={event => { setBuyerName(event.target.value); touch() }} minLength={2} maxLength={100} required disabled={!canSell}/></label>{knownBuyer && <p className="hint-success"><Check size={15}/> Participante existente: sus boletos se reunirán en el mismo enlace.</p>}</section>
        <section className="card summary-panel"><div className="panel-heading"><div><span className="step-dot">3</span><div><h2>Revisa la venta</h2><p>Cambia precios individuales si lo necesitas.</p></div></div></div>{selectedNumbers.length ? <div className="selected-list">{selectedNumbers.map(number => <div className="selected-row" key={number}><strong>#{formatTicket(number)}</strong><div className="mini-money"><span>$</span><input aria-label={`Precio del boleto ${number}`} inputMode="decimal" value={priceDrafts[number] ?? (selected[number] / 100).toFixed(2)} onChange={event => { const value = event.target.value; setPriceDrafts({ ...priceDrafts, [number]: value }); setSelected({ ...selected, [number]: parseMoney(value) ?? 0 }); touch() }} onBlur={() => { if (selected[number] > 0) { const next = { ...priceDrafts }; delete next[number]; setPriceDrafts(next) } }}/></div><button type="button" title={`Quitar boleto ${number}`} onClick={() => toggleTicket(number)}>×</button></div>)}</div> : <p className="empty-small">Tus boletos elegidos aparecerán aquí.</p>}<div className="total-row"><span>{selectedNumbers.length} {selectedNumbers.length === 1 ? 'boleto' : 'boletos'}</span><strong>{formatMoney(selectedTotal)}</strong></div><button className="button primary full" disabled={busy || !canSell || !selectedNumbers.length || selectedNumbers.length > remaining}>{busy ? 'Guardando venta…' : 'Confirmar venta'} <ArrowRight size={18}/></button></section></aside>
    </form> : <section className="sales-section"><div className="section-heading"><h2>Ventas registradas</h2><p>Consulta las compras y comparte el enlace de cada participante.</p></div>{groups.length ? <div className="sales-grid">{groups.map(items => { const first = items[0]; return <article className="card sale-card" key={first.sale_id}><div className="sale-card-top"><span className="round-icon violet"><UserRound size={20}/></span><div><strong>{first.participant_name}</strong><small>{first.phone}</small></div><span className="badge">{items.length} {items.length === 1 ? 'boleto' : 'boletos'}</span></div><div className="sold-numbers">{items.map(item => <span key={item.id}>#{formatTicket(item.ticket_number)} <small>{formatMoney(item.price_cents)}</small></span>)}</div><div className="sale-card-bottom"><strong>{formatMoney(items.reduce((sum, item) => sum + item.price_cents, 0))}</strong><div className="share-actions"><button className="button soft" onClick={() => openWhatsApp(first.share_token, first.phone)} aria-label={`Enviar por WhatsApp a ${first.participant_name}`}><MessageCircle size={16}/></button><button className="button soft" onClick={() => share(first.share_token, first.participant_name)}><Share2 size={16}/> Compartir</button></div></div></article> })}</div> : <div className="empty-card card"><Ticket size={35}/><h3>Todavía no hay ventas</h3><p>Selecciona tus primeros boletos y registra un participante.</p><button className="button primary" onClick={() => setTab('sell')}>Vender boletos <ArrowRight size={17}/></button></div>}</section>}
  </main>
}

function SparkleMark() { return <span aria-hidden="true">✦</span> }
function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) { return <div className={`stat-card ${tone}`}><span className="stat-icon">{icon}</span><span>{label}</span><strong>{value}</strong></div> }
