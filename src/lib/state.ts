import { asc } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { raffle, prizes } from '@/db/schema'
import { assert, type Session } from '@/lib/common'

export async function getDashboard(session: Session) {
  const [raffleRow] = await db.select().from(raffle).limit(1)
  const prizeRows = await db.select().from(prizes).orderBy(asc(prizes.sortOrder), asc(prizes.id))
  const vendorsResult = await pool.query(`
    SELECT v.id,v.name,v.quota,v.active,v.last_price_cents,
      count(si.id) FILTER (WHERE si.canceled_at IS NULL)::int AS sold_count,
      coalesce(sum(si.price_cents) FILTER (WHERE si.canceled_at IS NULL),0)::bigint AS total_cents
    FROM vendors v LEFT JOIN sales s ON s.vendor_id=v.id
    LEFT JOIN sale_items si ON si.sale_id=s.id
    GROUP BY v.id ORDER BY v.name`)
  const vendors = vendorsResult.rows.map(row => ({ ...row, total_cents: Number(row.total_cents) }))
  const itemsResult = await pool.query(`
    SELECT si.id,si.ticket_number,si.price_cents,si.canceled_at,s.id AS sale_id,s.created_at,
      s.vendor_id,s.participant_id,v.name AS vendor_name,p.name AS participant_name,
      p.phone,p.share_token
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    JOIN vendors v ON v.id=s.vendor_id JOIN participants p ON p.id=s.participant_id
    WHERE ($1::boolean OR s.vendor_id=$2) ORDER BY si.ticket_number`,
    [session.role === 'admin', session.vendorId ?? 0])
  const occupiedResult = await pool.query<{ ticket_number: number }>('SELECT ticket_number FROM sale_items WHERE canceled_at IS NULL')
  return {
    raffle: raffleRow,
    vendors,
    prizes: prizeRows,
    items: itemsResult.rows,
    occupiedNumbers: occupiedResult.rows.map(row => row.ticket_number),
    selectedVendorId: session.vendorId,
    role: session.role,
  }
}

type DrawRow = {
  id: number; prize_id: number; ordinal: number; ticket_number: number;
  participant_id: number; participant_name: string; kind: 'eliminated' | 'winner';
  created_at: Date; revealed_at: Date;
}

export async function getDrawSnapshot() {
  const [raffleRow] = await db.select().from(raffle).limit(1)
  assert(raffleRow, 503, 'La rifa todavía no está disponible.')
  const prizeRows = await db.select().from(prizes).orderBy(asc(prizes.sortOrder), asc(prizes.id))
  const result = await pool.query<DrawRow>(`
    SELECT e.*, p.name AS participant_name FROM extractions e
    JOIN participants p ON p.id=e.participant_id ORDER BY e.id`)
  const now = Date.now()
  const visible = result.rows.filter(row => new Date(row.revealed_at).getTime() <= now)
  const pending = result.rows.find(row => new Date(row.revealed_at).getTime() > now)
  const soldResult = await pool.query<{ ticket_number: number; participant_id: number }>(`
    SELECT si.ticket_number,s.participant_id FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE si.canceled_at IS NULL`)
  const excludedTickets = new Set(visible.map(row => row.ticket_number))
  const winners = new Set(visible.filter(row => row.kind === 'winner').map(row => row.participant_id))
  const eligibleCount = soldResult.rows.filter(row => !excludedTickets.has(row.ticket_number) && !winners.has(row.participant_id)).length
  const publicPrizes = prizeRows.map(prize => {
    const winner = visible.find(row => row.prize_id === prize.id && row.kind === 'winner')
    return {
      id: prize.id, title: prize.title, description: prize.description, imagePath: prize.imagePath,
      sortOrder: prize.sortOrder, drawCount: prize.drawCount,
      state: winner ? 'awarded' : prize.state === 'unawarded' ? 'unawarded' : 'pending',
      winnerTicketNumber: winner?.ticket_number ?? null,
      winnerName: winner ? shortName(winner.participant_name) : null,
    }
  })
  return {
    raffle: { name: raffleRow.name, status: pending && raffleRow.status === 'finished' ? 'drawing' : raffleRow.status },
    prizes: publicPrizes,
    extractions: visible.map(row => ({
      id: row.id, prizeId: row.prize_id, ordinal: row.ordinal, ticketNumber: row.ticket_number,
      participantId: row.participant_id, participantName: row.kind === 'winner' ? shortName(row.participant_name) : null,
      kind: row.kind, revealedAt: row.revealed_at,
    })),
    pending: pending ? {
      prizeId: pending.prize_id, ordinal: pending.ordinal,
      startedAt: pending.created_at, revealedAt: pending.revealed_at,
    } : null,
    soldCount: soldResult.rows.length,
    eligibleCount,
    serverNow: new Date().toISOString(),
  }
}

function shortName(name: string) {
  const words = name.trim().split(/\s+/)
  return words.length > 1 ? `${words[0]} ${words[1][0]}.` : words[0]
}

export async function getParticipantSnapshot(token: string) {
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), 404, 'Enlace no encontrado.')
  const personResult = await pool.query<{ id: number; name: string }>('SELECT id,name FROM participants WHERE share_token=$1', [token])
  const person = personResult.rows[0]
  assert(person, 404, 'Enlace no encontrado.')
  const ticketsResult = await pool.query<{ ticket_number: number }>(`
    SELECT si.ticket_number FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.participant_id=$1 AND si.canceled_at IS NULL ORDER BY si.ticket_number`, [person.id])
  const draw = await getDrawSnapshot()
  const eliminated = new Set(draw.extractions.filter(x => x.kind === 'eliminated').map(x => x.ticketNumber))
  const winner = draw.extractions.find(x => x.kind === 'winner' && x.participantId === person.id)
  return {
    name: person.name,
    raffle: draw.raffle,
    tickets: ticketsResult.rows.map(row => ({
      number: row.ticket_number,
      status: winner?.ticketNumber === row.ticket_number ? 'winner'
        : eliminated.has(row.ticket_number) ? 'eliminated'
          : winner ? 'excluded' : 'active',
    })),
    awards: draw.prizes.filter(x => x.winnerTicketNumber && ticketsResult.rows.some(t => t.ticket_number === x.winnerTicketNumber)),
  }
}
