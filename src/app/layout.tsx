import type { Metadata } from 'next'
import '@fontsource-variable/manrope'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mi Rifa · Boletos y sorteo',
  description: 'Administra boletos, consulta tu participación y sigue el sorteo en vivo.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>
}
