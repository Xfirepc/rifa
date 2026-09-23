'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronDown, Gift, Heart, LockKeyhole, Radio, RefreshCw, Sparkles, Ticket, Trophy } from 'lucide-react'
import { api, formatTicket, type ParticipantState } from '@/lib/client'
import styles from './Participant.module.css'

const ticketLabels = { active: 'Participando', eliminated: 'Eliminado', excluded: 'Premio ya obtenido', winner: '¡Ganador!' }
const previewCount = 8

export function Participant({ token }: { token: string }) {
  const [data, setData] = useState<ParticipantState | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let canceled = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await api<ParticipantState>(`public/participant/${token}`)
        if (!canceled) { setData(next); setError('') }
      } catch (cause) {
        if (!canceled) setError((cause as Error).message)
      } finally {
        if (!canceled) timer = setTimeout(refresh, 3000)
      }
    }
    refresh()
    return () => { canceled = true; clearTimeout(timer) }
  }, [token, retry])

  if (!data) return <main className={styles.fallback}>
    <span className={styles.fallbackIcon}><Ticket size={32} aria-hidden="true"/></span>
    <span className="eyebrow">TU RIFA, TU ILUSIÓN</span>
    <h1>{error ? 'Enlace no disponible' : 'Preparando tus boletos…'}</h1>
    <p role="status">{error || 'Un momento. Estamos buscando tus números de la suerte.'}</p>
    {error && <><button className="button primary" onClick={() => { setError(''); setRetry(value => value + 1) }}><RefreshCw size={16}/> Volver a intentar</button><p>Si el enlace cambió, pide uno nuevo a tu vendedor.</p></>}
  </main>

  const finished = data.raffle.status === 'finished'
  const drawing = data.raffle.status === 'drawing'
  const active = data.tickets.filter(ticket => ticket.status === 'active').length
  const visibleTickets = expanded ? data.tickets : data.tickets.slice(0, previewCount)
  const wonPrizes = new Set(data.awards.map(prize => prize.id))
  const status = finished ? 'Sorteo finalizado' : drawing ? 'El sorteo está en vivo' : 'La emoción está por empezar'

  return <main className={styles.page}>
    <header className={styles.nav}>
      <a href="#" className={styles.brand} aria-label={`${data.raffle.name}, inicio`}><span className="brand-symbol"><Ticket size={21} aria-hidden="true"/></span><span>{data.raffle.name}</span></a>
      <a href="/live" className={styles.navLink}><Radio size={16} aria-hidden="true"/><span>{finished ? 'Ver resultados' : 'Ver sorteo'}</span><ArrowRight size={15} aria-hidden="true"/></a>
    </header>

    <div className={styles.content}>
      <section className={styles.hero} aria-labelledby="participant-greeting">
        <div className={styles.heroMain}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><Sparkles size={16} aria-hidden="true"/> UN POQUITO DE SUERTE, MUCHA ILUSIÓN</span>
            <h1 id="participant-greeting">¡Hola, <span>{data.name.trim().split(/\s+/)[0]}!</span></h1>
            <p>Hay números que guardan grandes sorpresas.<br/>Estos son los tuyos. ¡Gracias por ser parte!</p>
            <div className={styles.heroActions}>
              <a href="#mis-boletos" className={styles.primaryLink}>Ver mis boletos <ArrowDown size={16} aria-hidden="true"/></a>
              <a href="#premios" className={styles.secondaryLink}>Descubrir los premios <Gift size={16} aria-hidden="true"/></a>
            </div>
          </div>
          <div className={styles.pass}>
            <div className={styles.passTop}><span>TU PASE A LA ILUSIÓN</span><Sparkles size={23} aria-hidden="true"/></div>
            <span className={styles.passLabel}>ESTA PARTICIPACIÓN ES DE</span>
            <strong className={styles.passName}>{data.name}</strong>
            <div className={styles.passNumbers}><Ticket size={29} aria-hidden="true"/><strong>{data.tickets.length}</strong><span>{data.tickets.length === 1 ? 'boleto a tu nombre' : 'boletos a tu nombre'}</span></div>
            <div className={styles.passFoot}><Heart size={14} aria-hidden="true"/><span>Una rifa para compartir la alegría</span></div>
          </div>
        </div>
        <div className={styles.heroFoot}>
          <span className={styles.raffleStatus}><span className={drawing ? styles.liveDot : styles.statusDot}/>{status}</span>
          <span><Gift size={15} aria-hidden="true"/>{data.prizes.length} {data.prizes.length === 1 ? 'premio' : 'premios'}</span>
          <span><Check size={15} aria-hidden="true"/>{finished ? 'Resultados disponibles' : `${active} ${active === 1 ? 'boleto participando' : 'boletos participando'}`}</span>
        </div>
      </section>

      {error && <p className={styles.connectionNotice} role="status"><RefreshCw size={16} aria-hidden="true"/>No pudimos actualizar los resultados. Reintentando…</p>}

      {data.awards.length > 0 && <section className={styles.winnerAlert} aria-label="Tus premios" aria-live="polite">
        <span className={styles.winnerIcon}><Trophy size={29} aria-hidden="true"/></span>
        <div><span className="eyebrow">¡LA SUERTE ESTUVO DE TU LADO!</span><h2>Esta vez, la alegría es tuya.</h2>{data.awards.map(prize => <p key={prize.id}>Ganaste <strong>{prize.title}</strong> con el boleto <strong>#{formatTicket(prize.winnerTicketNumber!)}</strong>.</p>)}</div>
      </section>}

      <section id="mis-boletos" className={styles.section} aria-labelledby="tickets-heading">
        <div className={styles.sectionHeading}><div><span className="eyebrow"><Ticket size={15} aria-hidden="true"/> TU PARTICIPACIÓN</span><h2 id="tickets-heading">Tus números de la suerte<span className={styles.count}>{data.tickets.length}</span></h2><p>{finished ? 'El sorteo terminó. Aquí puedes consultar cómo quedaron tus boletos.' : 'Cada boleto, una nueva ilusión. Su estado se actualiza durante el sorteo.'}</p></div><a href="#premios" className={styles.sectionLink}>Ver premios <ArrowDown size={15} aria-hidden="true"/></a></div>
        {data.tickets.length ? <>
          <ul id="lista-boletos" className={styles.ticketGrid}>
            {visibleTickets.map(ticket => <li key={ticket.number} className={`${styles.ticket} ${styles[ticket.status]} ${finished && ticket.status === 'active' ? styles.closed : ''}`}>
              <div className={styles.ticketTop}><span>MI BOLETO</span><Ticket size={17} aria-hidden="true"/></div>
              <strong><span>#</span>{formatTicket(ticket.number)}</strong>
              <div className={styles.ticketBottom}><span>{ticket.status === 'winner' ? <Trophy size={12} aria-hidden="true"/> : ticket.status === 'active' && !finished ? <span className={styles.ticketDot}/> : null}{finished && ticket.status === 'active' ? 'Sin premio' : ticketLabels[ticket.status]}</span></div>
            </li>)}
          </ul>
          {data.tickets.length > previewCount && <button className={styles.expandButton} aria-expanded={expanded} aria-controls="lista-boletos" onClick={() => setExpanded(value => !value)}>{expanded ? 'Mostrar menos boletos' : `Ver los ${data.tickets.length} boletos`}<ChevronDown size={17} className={expanded ? styles.chevronUp : ''} aria-hidden="true"/></button>}
        </> : <div className={styles.empty}><Ticket size={28} aria-hidden="true"/><h3>Tus próximos números aparecerán aquí</h3><p>Por ahora no hay boletos a tu nombre. Consulta con tu vendedor si falta alguno.</p></div>}
      </section>

      <section id="premios" className={styles.section} aria-labelledby="prizes-heading">
        <div className={styles.sectionHeading}><div><span className="eyebrow"><Sparkles size={15} aria-hidden="true"/> HAY MUCHO POR LO QUE ILUSIONARSE</span><h2 id="prizes-heading">Los premios de esta rifa</h2><p>{finished ? 'Estas son las sorpresas que formaron parte del sorteo.' : 'Conoce las sorpresas que podrías llevarte a casa.'}</p></div><span className={styles.prizeCount}><Gift size={16} aria-hidden="true"/>{data.prizes.length} {data.prizes.length === 1 ? 'premio' : 'premios'}</span></div>
        {data.prizes.length ? <div className={styles.prizeGrid}>{data.prizes.map((prize, index) => <article key={prize.id} className={`${styles.prizeCard} ${wonPrizes.has(prize.id) ? styles.yourPrize : ''}`}>
          <div className={styles.prizeImage}>
            <PrizeImage src={prize.imagePath} title={prize.title}/>
            <span className={styles.prizeNumber}>PREMIO {String(index + 1).padStart(2, '0')}</span>
            {wonPrizes.has(prize.id) && <span className={styles.yourPrizeBadge}><Trophy size={13} aria-hidden="true"/> ¡Es tuyo!</span>}
          </div>
          <div className={styles.prizeBody}><h3>{prize.title}</h3>{prize.description && <p>{prize.description}</p>}
            <div className={styles.prizeResult}>{prize.winnerTicketNumber ? <><Trophy size={17} aria-hidden="true"/><div><strong>Ganador #{formatTicket(prize.winnerTicketNumber)}</strong><span>{wonPrizes.has(prize.id) ? '¡Felicidades! Este premio es tuyo.' : prize.winnerName}</span></div></> : <><Gift size={17} aria-hidden="true"/><span>{prize.state === 'unawarded' ? 'Sin adjudicar' : 'Por sortear'}</span></>}</div>
          </div>
        </article>)}</div> : <div className={styles.empty}><Gift size={30} aria-hidden="true"/><h3>Estamos preparando las sorpresas</h3><p>Los premios aparecerán aquí cuando el organizador los agregue.</p></div>}
      </section>

      <section className={styles.liveBanner} aria-label="Seguir el sorteo"><span className={styles.liveIcon}><Radio size={28} aria-hidden="true"/></span><div><h2>{finished ? 'Revive la emoción del sorteo' : drawing ? '¡La suerte se está decidiendo!' : 'Lo mejor está por venir'}</h2><p>{finished ? 'Consulta los números ganadores y todos los resultados.' : 'Acompáñanos y descubre cada número junto a nosotros.'}</p></div><a href="/live" className={styles.primaryLink}>{finished ? 'Ver resultados' : 'Ir al sorteo'}<ArrowRight size={17} aria-hidden="true"/></a></section>

      <footer className={styles.footer}><span><LockKeyhole size={14} aria-hidden="true"/>Este enlace es personal. Guárdalo para consultar tus boletos.</span><span>Hecho para compartir ilusión <Heart size={14} aria-hidden="true"/></span></footer>
    </div>
  </main>
}

function PrizeImage({ src, title }: { src: string | null; title: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && failedSrc !== src) return <img src={src} alt={title} loading="lazy" decoding="async" onError={() => setFailedSrc(src)}/>
  return <div className={styles.prizePlaceholder} aria-hidden="true"><span/><Gift size={62} strokeWidth={1.2}/><Sparkles size={24} strokeWidth={1.4}/></div>
}
