import { Participant } from '@/components/Participant'

export default async function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <Participant token={token} />
}
