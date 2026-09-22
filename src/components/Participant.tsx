'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Gift, Radio, Sparkles, Ticket, Trophy } from 'lucide-react'
import { api, formatTicket } from '@/lib/client'

type ParticipantState = {
  name: string; raffle: { name: string; status: string };
  tickets: { number: number; status: 'active' | 'eliminated' | 'excluded' | 'winner' }[];
  awards: { id: number; title: string; winnerTicketNumber: number }[];
}

export function Participant({ token }: { token: string }) {
  const [data, setData] = useState<ParticipantState | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(() => api<ParticipantState>(`public/participant/${token}`).then(setData).catch(cause => setError((cause as Error).message)), [token])
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer) }, [refresh])
  if (error && !data) return <main className="participant-page"><div className="empty-card card"><Ticket size={35}/><h1>Enlace no disponible</h1><p>{error}</p></div></main>
  if (!data) return <div className="page-loader"><Ticket/><span>Buscando tus boletos…</span></div>
  const counts = { active: data.tickets.filter(t => t.status === 'active').length, winner: data.tickets.filter(t => t.status === 'winner').length }
  return <main className="participant-page"><header className="participant-nav"><a href="/" className="brand dark"><span className="brand-symbol"><Ticket size={20}/></span><span>{data.raffle.name}</span></a><a href="/live" className="header-link"><Radio size={16}/> Sorteo en vivo</a></header><div className="participant-content"><div className="participant-hero"><span className="eyebrow"><Sparkles size={16}/> MIS BOLETOS DE LA SUERTE</span><h1>¡Hola, {data.name.split(' ')[0]}!</h1><p>Aquí están todos tus boletos de esta rifa. Guarda este enlace para volver cuando quieras.</p><div className="participant-count"><span><strong>{data.tickets.length}</strong> {data.tickets.length === 1 ? 'boleto a tu nombre' : 'boletos a tu nombre'}</span><span><strong>{counts.active}</strong> siguen participando</span></div></div>{counts.winner > 0 && <div className="winner-alert"><Trophy size={31}/><div><h2>¡Ganaste un premio!</h2><p>{data.awards.map(x => `${x.title} con el boleto #${formatTicket(x.winnerTicketNumber)}`).join(' · ')}</p></div></div>}<section className="participant-tickets"><div className="section-heading"><h2>Tus números</h2><p>Los estados se actualizan durante el sorteo.</p></div>{data.tickets.length ? <div className="my-ticket-grid">{data.tickets.map(ticket => <div key={ticket.number} className={`my-ticket ${ticket.status}`}><span>BOLETO</span><strong>#{formatTicket(ticket.number)}</strong><small>{ticket.status === 'winner' ? '🏆 Ganador' : ticket.status === 'eliminated' ? 'Eliminado' : ticket.status === 'excluded' ? 'Premio obtenido' : 'Participando'}</small></div>)}</div> : <div className="empty-card card"><Gift size={33}/><h3>No tienes boletos activos</h3><p>Consulta con tu vendedor si crees que falta alguno.</p></div>}</section><a href="/live" className="button primary participant-live"><Radio size={17}/> Seguir el sorteo en vivo</a></div></main>
}
