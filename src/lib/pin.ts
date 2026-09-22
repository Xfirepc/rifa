import { createHmac } from 'node:crypto'

export const isPin = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{6}$/.test(value)

export function configuredPin(role: 'admin' | 'seller') {
  const admin = process.env.ADMIN_PIN
  const seller = process.env.SELLER_PIN
  if (!isPin(admin) || !isPin(seller) || admin === seller) return null
  return role === 'admin' ? admin : seller
}

// The cookie is the HMAC key: the database cannot be used to guess the short PIN.
// Changing a role's PIN also invalidates its existing sessions.
export function pinSessionProof(token: string, role: string, pin: string) {
  return createHmac('sha256', token).update(`${role}:${pin}`).digest('hex')
}
