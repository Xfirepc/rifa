'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Gift, Maximize2, Play, Radio, Sparkles, Ticket, Trophy, Users } from 'lucide-react'
import { api, type DrawState, formatTicket } from '@/lib/client'

export function Live({ admin = false }: { admin?: boolean }) {
  const [data, setData] = useState<DrawState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [spin, setSpin] = useState('••••')
  const requestId = useRef<string | null>(null)
  const poll = useCallback(async () => { try { setData(await api<DrawState>('public/draw')); setLoading(false) } catch (cause) { setError((cause as Error).message); setLoading(false) } }, [])
  useEffect(() => { poll(); const timer = setInterval(poll, 1000); return () => clearInterval(timer) }, [poll])
  useEffect(() => {
    if (!data?.pending) return
    const timer = setInterval(() => setSpin(formatTicket(Math.floor(Math.random() * 1000) + 1)), 75)
    return () => clearInterval(timer)
  }, [data?.pending])

  async function start() {
    if (!window.confirm('Se cerrarán las ventas y correcciones. ¿Iniciar el sorteo?')) return
    setBusy(true); setError('')
    try { setData(await api<DrawState>('admin/start', { method: 'POST' })) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function draw(prizeId: number, expectedOrdinal: number) {
    setBusy(true); setError('')
    requestId.current ??= crypto.randomUUID()
    try {
      setData(await api<DrawState>('admin/draw', { method: 'POST', body: JSON.stringify({ requestId: requestId.current, prizeId, expectedOrdinal }) }))
      requestId.current = null
    } catch (cause) { setError((cause as Error).message); await poll() }
    finally { setBusy(false) }
  }
  const current = data?.prizes.find(prize => prize.state === 'pending')
  const currentDraws = data?.extractions.filter(item => item.prizeId === current?.id) ?? []
  const latest = data?.extractions.at(-1)
  const pending = data?.pending
  const display = pending ? spin : latest ? formatTicket(latest.ticketNumber) : '????'
  const winning = !pending && latest?.kind === 'winner'
  const focusedPrize = data?.prizes.find(prize => prize.id === (pending?.prizeId ?? latest?.prizeId)) ?? current
  const nextCount = currentDraws.length + 1
  const canDraw = !!admin && data?.raffle.status === 'drawing' && !!current && !pending && !busy

  if (loading) return <div className="page-loader"><Ticket/><span>Preparando sorteo…</span></div>
  return <main className={`live-page ${admin ? 'embedded' : ''}`}>
    <div className="live-top"><div className="brand"><span className="brand-symbol"><Ticket size={20}/></span><span>{data?.raffle.name ?? 'Mi Rifa'}</span></div><div className="live-top-right"><span className="live-indicator"><Radio size={15}/> {data?.raffle.status === 'open' ? 'PRÓXIMAMENTE' : data?.raffle.status === 'finished' ? 'FINALIZADO' : 'EN VIVO'}</span>{!admin && <a href="/" className="live-home">Entrar <ArrowRight size={16}/></a>}<button className="icon-button pale" onClick={() => document.documentElement.requestFullscreen?.()} title="Pantalla completa" aria-label="Pantalla completa"><Maximize2 size={18}/></button></div></div>
    <div className="live-layout"><section className="draw-stage"><div className="stage-glow glow-one"/><div className="stage-glow glow-two"/><div className="stage-content"><span className="stage-eyebrow"><Sparkles size={15}/> EL GRAN SORTEO</span><h1>{data?.raffle.status === 'open' ? 'La emoción está por empezar' : data?.raffle.status === 'finished' && !pending ? '¡Gracias por participar!' : focusedPrize?.title ?? 'La suerte está en juego'}</h1><p>{data?.raffle.status === 'open' ? 'Pronto conoceremos a los ganadores.' : focusedPrize?.description || 'Cada número cuenta una historia. ¿Será la tuya?'}</p><div className={`draw-ball ${pending ? 'spinning' : ''} ${winning ? 'winner-ball' : ''}`}><div className="ball-inner"><span>{pending ? 'SORTEANDO' : winning ? 'BOLETO GANADOR' : latest ? 'ÚLTIMO NÚMERO' : 'TU NÚMERO'}</span><strong aria-hidden={!!pending}>{display}</strong></div></div>{pending ? <div className="draw-message"><span className="pulse-dot"/> Extracción {pending.ordinal} en curso…</div> : latest ? <div className={`draw-message ${winning ? 'winner-message' : ''}`}>{winning ? <><Trophy size={20}/> ¡Ganó {latest.participantName}!</> : <><Ticket size={20}/> #{formatTicket(latest.ticketNumber)} quedó fuera de la rifa</>}</div> : <div className="draw-message">La suerte puede estar en cualquier boleto ✨</div>}{admin && data?.raffle.status === 'open' && <button className="button bright" onClick={start} disabled={busy}>Cerrar ventas e iniciar sorteo <Play size={18}/></button>}{canDraw && <button className="button bright" onClick={() => draw(current.id, nextCount)}>Sacar número {nextCount} de {current.drawCount} <Play size={18}/></button>}{admin && current && !pending && data?.raffle.status === 'drawing' && data.eligibleCount < current.drawCount - currentDraws.length && <p className="stage-tip">Quedan {data.eligibleCount} boletos elegibles. Ajusta las extracciones del premio pendiente en Administración.</p>}</div></section>
      <aside className="live-side"><div className="live-summary"><div><span className="round-icon violet"><Ticket size={20}/></span><strong>{data?.soldCount ?? 0}</strong><small>Boletos vendidos</small></div><div><span className="round-icon mint"><Users size={20}/></span><strong>{data?.eligibleCount ?? 0}</strong><small>{data?.raffle.status === 'finished' ? 'Elegibles al cierre' : 'Siguen participando'}</small></div></div><section className="live-prizes"><div className="section-heading"><span className="eyebrow"><Gift size={15}/> LA LISTA DE PREMIOS</span><h2>Premios de esta rifa</h2></div>{data?.prizes.length ? data.prizes.map((prize, index) => <article className={`live-prize ${focusedPrize?.id === prize.id ? 'active' : ''}`} key={prize.id}>{prize.imagePath ? <img src={prize.imagePath} alt=""/> : <span className="prize-placeholder"><Gift size={21}/></span>}<div><small>PREMIO {String(index + 1).padStart(2, '0')}</small><strong>{prize.title}</strong><span>{prize.winnerTicketNumber ? `Ganador #${formatTicket(prize.winnerTicketNumber)} · ${prize.winnerName}` : prize.state === 'unawarded' ? 'Sin adjudicar' : `${prize.drawCount} extracciones`}</span></div>{prize.winnerTicketNumber && <Check size={19} className="won-check"/>}</article>) : <div className="empty-mini">Los premios aparecerán aquí.</div>}</section><section className="live-history"><div className="section-heading"><span className="eyebrow">ASÍ VA EL SORTEO</span><h2>Extracciones</h2></div>{data?.extractions.length ? [...data.extractions].reverse().slice(0, 12).map(item => <div className="history-row" key={item.id}><span className={item.kind === 'winner' ? 'history-number winner' : 'history-number'}>#{formatTicket(item.ticketNumber)}</span><span>{item.kind === 'winner' ? 'Ganador' : 'Eliminado'}</span><small>Ronda {item.ordinal}</small></div>) : <div className="empty-mini">Esperando el primer número.</div>}</section></aside></div>
    {error && <div className="live-error" role="alert">{error}</div>}
  </main>
}
