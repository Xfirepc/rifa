import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMoney, formatMoney, formatTicket, whatsAppNumber } from '../src/lib/client.ts'

test('USD acepta centavos exactos y rechaza valores ambiguos', () => {
  assert.equal(parseMoney('1.50'), 150)
  assert.equal(parseMoney('1,50'), 150)
  assert.equal(parseMoney('0.01'), 1)
  assert.equal(parseMoney('0'), null)
  assert.equal(parseMoney('1.234'), null)
  assert.equal(parseMoney('1e3'), null)
  assert.equal(formatMoney(6250), '$62.50')
  assert.equal(formatTicket(1), '0001')
  assert.equal(formatTicket(1000), '1000')
  assert.equal(whatsAppNumber('0991234567'), '593991234567')
  assert.equal(whatsAppNumber('+593991234567'), '593991234567')
})
