export type Vendor = {
  id: number; name: string; quota: number; active: boolean;
  last_price_cents: number | null; sold_count: number; total_cents: number;
}
export type Item = {
  id: number; ticket_number: number; price_cents: number; canceled_at: string | null;
  sale_id: number; created_at: string; vendor_id: number; participant_id: number;
  vendor_name: string; participant_name: string; phone: string; share_token: string;
}
export type Prize = {
  id: number; title: string; description: string; imagePath: string | null;
  sortOrder: number; drawCount: number; state: 'pending' | 'active' | 'awarded' | 'unawarded';
  winnerParticipantId: number | null; winnerTicketNumber: number | null;
}
export type Dashboard = {
  raffle: { id: number; name: string; status: 'open' | 'drawing' | 'finished' };
  vendors: Vendor[]; prizes: Prize[]; items: Item[]; occupiedNumbers: number[];
  selectedVendorId: number | null; role: 'admin' | 'seller';
}
export type DrawState = {
  raffle: { name: string; status: 'open' | 'drawing' | 'finished' };
  prizes: { id: number; title: string; description: string; imagePath: string | null; sortOrder: number; drawCount: number; state: string; winnerTicketNumber: number | null; winnerName: string | null }[];
  extractions: { id: number; prizeId: number; ordinal: number; ticketNumber: number; participantId: number; participantName: string | null; kind: 'eliminated' | 'winner'; revealedAt: string }[];
  pending: { prizeId: number; ordinal: number; startedAt: string; revealedAt: string } | null;
  soldCount: number; eligibleCount: number; serverNow: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? 'No se pudo completar la operación.')
  return data as T
}

export const formatMoney = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export const formatTicket = (number: number) => String(number).padStart(4, '0')
export function parseMoney(value: string) {
  const clean = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const cents = Math.round(Number(clean) * 100)
  return cents >= 1 && cents <= 100_000_000 ? cents : null
}

export async function shareParticipant(token: string, name: string) {
  const url = `${window.location.origin}/p/${token}`
  if (navigator.share) {
    try { await navigator.share({ title: `Boletos de ${name}`, text: `Consulta tus boletos de la rifa:`, url }); return }
    catch (error) { if ((error as Error).name === 'AbortError') return }
  }
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return }
  window.prompt('Copia este enlace', url)
}

export function whatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 && digits.startsWith('0') ? `593${digits.slice(1)}` : digits.length === 9 && digits.startsWith('9') ? `593${digits}` : digits
}

export function openWhatsApp(token: string, phone: string) {
  const number = whatsAppNumber(phone)
  const link = `${window.location.origin}/p/${token}`
  const message = encodeURIComponent(`¡Hola! Aquí puedes consultar tus boletos de la rifa: ${link}`)
  window.open(`https://wa.me/${number}?text=${message}`, '_blank', 'noopener,noreferrer')
}
