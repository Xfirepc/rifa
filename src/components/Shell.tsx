'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Gift, LockKeyhole, LogOut, Sparkles, Ticket, Tv } from 'lucide-react'
import { api, type DrawState } from '@/lib/client'
import { Seller } from '@/components/Seller'
import { Admin } from '@/components/Admin'

type SessionInfo = { role: 'seller' | 'admin'; vendorId: number | null } | null

export function Shell() {
  const [session, setSession] = useState<SessionInfo | undefined>(undefined)
  const [role, setRole] = useState<'seller' | 'admin'>('seller')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [raffleName, setRaffleName] = useState('Mi Rifa')

  useEffect(() => { api<SessionInfo>('auth/me').then(setSession).catch(() => setSession(null)) }, [])
  useEffect(() => { api<DrawState>('public/draw').then(draw => setRaffleName(draw.raffle.name)).catch(() => {}) }, [])
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { setSession(await api<SessionInfo>('auth/login', { method: 'POST', body: JSON.stringify({ role, pin }) })); setPin('') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function logout() {
    await api('auth/logout', { method: 'POST' }); setSession(null)
  }

  if (session === undefined) return <div className="page-loader"><div className="brand-symbol"><Ticket size={24}/></div><span>Cargando tu rifa…</span></div>
  if (!session) return <main className="login-page">
    <section className="login-story">
      <div className="brand"><span className="brand-symbol"><Ticket size={22}/></span><span>{raffleName}</span></div>
      <div className="story-content">
        <span className="eyebrow light"><Sparkles size={15}/> UNA RIFA, MUCHAS ILUSIONES</span>
        <h1>Vender boletos<br/><em>se siente fácil.</em></h1>
        <p>Selecciona números, registra participantes y prepara un sorteo que todos disfrutarán ver.</p>
        <div className="story-badges"><span><Ticket size={17}/> 1,000 números</span><span><Gift size={17}/> Premios a tu manera</span></div>
      </div>
      <div className="floating-ticket"><span>BOLETO DE LA SUERTE</span><strong>0007</strong><small>Tu próxima gran historia empieza aquí ✦</small></div>
      <div className="story-orb orb-a"/><div className="story-orb orb-b"/>
    </section>
    <section className="login-panel">
      <div className="login-card">
        <span className="eyebrow"><LockKeyhole size={15}/> ACCESO PROTEGIDO</span>
        <h2>¡Hola de nuevo!</h2>
        <p>Ingresa tu PIN de seis dígitos para comenzar.</p>
        <div className="role-switch" role="group" aria-label="Tipo de acceso">
          <button type="button" className={role === 'seller' ? 'active' : ''} onClick={() => { setRole('seller'); setError('') }}>Soy vendedor</button>
          <button type="button" className={role === 'admin' ? 'active' : ''} onClick={() => { setRole('admin'); setError('') }}>Administración</button>
        </div>
        <form onSubmit={login}>
          <label className="field-label" htmlFor="pin">PIN de acceso</label>
          <div className="password-field"><input id="pin" className="pin-input" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} type={showPin ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••" value={pin} onChange={event => setPin(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} required/><button type="button" aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'} onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="button primary full" disabled={busy || pin.length !== 6}>{busy ? 'Ingresando…' : 'Entrar a la rifa'} <ArrowRight size={18}/></button>
        </form>
        <a className="live-link" href="/live"><Tv size={17}/> Ver el sorteo en vivo <ArrowRight size={15}/></a>
      </div>
      <p className="login-footnote">Hecho para compartir momentos que emocionan ✨</p>
    </section>
  </main>

  return <div className="app-shell">
    <header className="topbar"><a className="brand dark" href="/"><span className="brand-symbol"><Ticket size={20}/></span><span>{raffleName}</span></a><div className="topbar-right"><a href="/live" target="_blank" rel="noreferrer" className="header-link"><Tv size={17}/><span>Sorteo en vivo</span></a><span className="role-pill">{session.role === 'admin' ? 'Administrador' : 'Vendedor'}</span><button className="icon-button" onClick={logout} title="Salir" aria-label="Salir"><LogOut size={19}/></button></div></header>
    {session.role === 'admin' ? <Admin/> : <Seller selectedVendorId={session.vendorId} onVendorSelected={vendorId => setSession({ role: 'seller', vendorId })}/>}
  </div>
}
