import type { Metadata } from 'next'
import { Participant } from '@/components/Participant'

export const metadata: Metadata = {
  title: 'Tus boletos y premios · Mi Rifa',
  description: 'Un lugar para consultar tus números, descubrir los premios y seguir la emoción del sorteo.',
  referrer: 'same-origin',
}

export default async function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <Participant token={token} />
}
