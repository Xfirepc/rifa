import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1'
const adminPin = process.env.ADMIN_PIN
const sellerPin = process.env.SELLER_PIN

class Client {
  cookie = ''
  async call(method, path, body) {
    const response = await fetch(`${base}/api/${path}`, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    const cookie = response.headers.get('set-cookie')
    if (cookie?.startsWith('rf_session=')) this.cookie = cookie.split(';')[0]
    const data = await response.json()
    return { status: response.status, data }
  }
}

function expectStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data))
  return result.data
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('ventas, exclusividad, enlaces y sorteo con PostgreSQL', { timeout: 120_000 }, async () => {
  assert.ok(adminPin && sellerPin, 'Define ADMIN_PIN y SELLER_PIN para la prueba.')
  const a = new Client(), b = new Client(), c = new Client(), admin = new Client(), publicClient = new Client()
  expectStatus(await a.call('POST', 'auth/login', { role: 'seller', pin: sellerPin }), 200)
  expectStatus(await b.call('POST', 'auth/login', { role: 'seller', pin: sellerPin }), 200)
  expectStatus(await c.call('POST', 'auth/login', { role: 'seller', pin: sellerPin }), 200)
  expectStatus(await admin.call('POST', 'auth/login', { role: 'admin', pin: adminPin }), 200)
  const stamp = String(Date.now())
  const vendorA = expectStatus(await a.call('POST', 'vendors', { name: `Ana ${stamp}` }), 201)
  const vendorB = expectStatus(await b.call('POST', 'vendors', { name: `Bruno ${stamp}` }), 201)
  expectStatus(await c.call('POST', 'vendors', { name: `Carla ${stamp}` }), 201)
  assert.ok(vendorA.id && vendorB.id)

  const buyer = { name: 'Patricia Prueba', phone: '0991234567' }
  const fifty = { requestId: randomUUID(), participant: buyer, items: Array.from({ length: 50 }, (_, i) => ({ number: i + 1, priceCents: i < 25 ? 150 : 100 })) }
  const first = expectStatus(await a.call('POST', 'sales', fifty), 201)
  assert.ok(first.shareToken)
  expectStatus(await a.call('POST', 'sales', fifty), 200)
  let state = expectStatus(await a.call('GET', 'state'), 200)
  assert.equal(state.vendors.find(v => v.id === vendorA.id).sold_count, 50)
  assert.equal(state.vendors.find(v => v.id === vendorA.id).total_cents, 6250)
  expectStatus(await a.call('POST', 'sales', { requestId: randomUUID(), participant: buyer, items: [{ number: 100, priceCents: 100 }] }), 409)
  expectStatus(await b.call('POST', 'sales', { requestId: randomUUID(), participant: buyer, items: [{ number: 1, priceCents: 100 }] }), 409)

  const another = expectStatus(await b.call('POST', 'sales', { requestId: randomUUID(), participant: { name: buyer.name, phone: '+593991234567' }, items: [{ number: 51, priceCents: 175 }] }), 201)
  assert.equal(another.shareToken, first.shareToken)
  const participant = expectStatus(await publicClient.call('GET', `public/participant/${first.shareToken}`), 200)
  assert.equal(participant.tickets.length, 51)
  assert.ok(!JSON.stringify(participant).includes('+593991234567'))
  for (let i = 0; i < 10; i++) {
    expectStatus(await b.call('POST', 'sales', { requestId: randomUUID(), participant: { name: `Persona ${i + 1}`, phone: `+59399${String(1000000 + i)}` }, items: [{ number: 52 + i, priceCents: 100 }] }), 201)
  }

  const race = await Promise.all([
    b.call('POST', 'sales', { requestId: randomUUID(), participant: { name: 'Persona B', phone: '+593992000001' }, items: [{ number: 62, priceCents: 100 }] }),
    c.call('POST', 'sales', { requestId: randomUUID(), participant: { name: 'Persona C', phone: '+593992000002' }, items: [{ number: 62, priceCents: 125 }] }),
  ])
  assert.deepEqual(race.map(x => x.status).sort(), [201, 409])
  state = expectStatus(await admin.call('GET', 'state'), 200)
  assert.equal(state.occupiedNumbers.filter(n => n === 62).length, 1)
  const item1 = state.items.find(x => x.ticket_number === 1 && !x.canceled_at)
  const item2 = state.items.find(x => x.ticket_number === 2 && !x.canceled_at)
  expectStatus(await admin.call('PATCH', `admin/items/${item1.id}`, { priceCents: 200 }), 200)
  state = expectStatus(await admin.call('GET', 'state'), 200)
  assert.equal(state.vendors.find(v => v.id === vendorA.id).total_cents, 6300)
  expectStatus(await admin.call('PATCH', `admin/items/${item1.id}`, { priceCents: 150 }), 200)
  expectStatus(await admin.call('DELETE', `admin/items/${item2.id}`), 200)
  expectStatus(await a.call('POST', 'sales', { requestId: randomUUID(), participant: buyer, items: [{ number: 2, priceCents: 150 }] }), 201)
  state = expectStatus(await admin.call('GET', 'state'), 200)
  assert.equal(state.vendors.find(v => v.id === vendorA.id).sold_count, 50)
  assert.equal(state.vendors.find(v => v.id === vendorA.id).total_cents, 6250)

  const prize1 = expectStatus(await admin.call('POST', 'admin/prizes', { title: 'Premio primero', description: 'Prueba de cinco extracciones', drawCount: 5 }), 201)
  const prize2 = expectStatus(await admin.call('POST', 'admin/prizes', { title: 'Premio segundo', drawCount: 1 }), 201)
  expectStatus(await admin.call('POST', 'admin/start'), 200)
  expectStatus(await b.call('POST', 'sales', { requestId: randomUUID(), participant: buyer, items: [{ number: 63, priceCents: 100 }] }), 409)
  expectStatus(await admin.call('DELETE', `admin/items/${item1.id}`), 409)

  for (let ordinal = 1; ordinal <= 5; ordinal++) {
    const before = expectStatus(await publicClient.call('GET', 'public/draw'), 200)
    const request = { requestId: randomUUID(), prizeId: prize1.id, expectedOrdinal: ordinal }
    const start = expectStatus(await admin.call('POST', 'admin/draw', request), 200)
    assert.equal(start.extractions.length, ordinal - 1)
    assert.equal(start.pending?.ordinal, ordinal)
    const duplicate = expectStatus(await admin.call('POST', 'admin/draw', request), 200)
    assert.equal(duplicate.extractions.length, ordinal - 1)
    assert.equal(before.extractions.length, ordinal - 1)
    await sleep(4200)
    const after = expectStatus(await publicClient.call('GET', 'public/draw'), 200)
    assert.equal(after.extractions.length, ordinal)
    assert.equal(after.extractions.at(-1).kind, ordinal === 5 ? 'winner' : 'eliminated')
  }

  const secondRequest = { requestId: randomUUID(), prizeId: prize2.id, expectedOrdinal: 1 }
  const secondStart = expectStatus(await admin.call('POST', 'admin/draw', secondRequest), 200)
  assert.equal(secondStart.pending?.prizeId, prize2.id)
  await sleep(4200)
  const final = expectStatus(await publicClient.call('GET', 'public/draw'), 200)
  assert.equal(final.raffle.status, 'finished')
  assert.equal(final.extractions.length, 6)
  assert.equal(new Set(final.extractions.map(x => x.ticketNumber)).size, 6)
  const winners = final.extractions.filter(x => x.kind === 'winner')
  assert.equal(winners.length, 2)
  assert.equal(new Set(winners.map(x => x.participantId)).size, 2)
})
