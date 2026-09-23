import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3008'
const token = 'p'.repeat(43)
const fixture = () => ({
  name: 'Patricia Mendoza',
  raffle: { name: 'Una rifa, muchas sonrisas', status: 'open' },
  tickets: [7, 24, 89, 126, 208, 315, 472, 689, 750, 1000].map(number => ({ number, status: 'active' })),
  prizes: [
    { id: 1, title: 'Un regalo para disfrutar', description: 'Una sorpresa especial para compartir en familia y crear nuevos recuerdos.', imagePath: '/api/images/prize-fixture.svg', sortOrder: 1, drawCount: 5, state: 'pending', winnerTicketNumber: null, winnerName: null },
    { id: 2, title: 'Canasta de alegría', description: 'Pequeños detalles, grandes momentos. Una selección preparada con mucho cariño.', imagePath: null, sortOrder: 2, drawCount: 3, state: 'pending', winnerTicketNumber: null, winnerName: null },
    { id: 3, title: 'La sorpresa final', description: 'El último premio también guarda algo muy especial para ti.', imagePath: '/api/images/missing-fixture.png', sortOrder: 3, drawCount: 1, state: 'pending', winnerTicketNumber: null, winnerName: null },
  ],
  awards: [],
})

test('enlace del comprador: premios, móvil, resultados y recuperación de conexión', { timeout: 60_000 }, async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let snapshot = fixture()
    let responseStatus = 200
    await page.route('**/api/public/participant/*', route => route.fulfill({ status: responseStatus, json: responseStatus === 200 ? snapshot : { error: 'Enlace no encontrado.' } }))
    await page.route('**/api/images/prize-fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="#e6ddf2"/><circle cx="300" cy="200" r="143" fill="#ffffff" opacity=".28"/><rect x="210" y="170" width="180" height="140" rx="12" fill="#8972ad"/><rect x="195" y="147" width="210" height="40" rx="8" fill="#a28ac4"/><path d="M289 147V310H312V147" fill="#e9cdf8"/><path d="M300 145C204 151 231 76 269 103L300 143C396 148 368 76 332 104Z" fill="none" stroke="#c7aadf" stroke-width="13" stroke-linejoin="round"/></svg>' }))
    await page.route('**/api/images/missing-fixture.png', route => route.fulfill({ status: 404, body: '' }))

    await t.test('premios accesibles y boletos completos en escritorio y móvil', async () => {
      await page.goto(`${base}/p/${token}`)
      await page.getByRole('heading', { name: '¡Hola, Patricia!' }).waitFor()
      assert.equal(await page.locator('#premios article').count(), 3)
      await page.getByRole('img', { name: snapshot.prizes[0].title }).scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelector('#premios img')?.naturalWidth > 0)
      // Una imagen ausente conserva la tarjeta y su título, sin iconos rotos.
      await page.locator('#premios article').last().scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelectorAll('#premios img').length === 1)
      assert.equal(await page.locator('#lista-boletos li').count(), 8)
      await page.getByRole('button', { name: 'Ver los 10 boletos' }).click()
      assert.equal(await page.locator('#lista-boletos li').count(), 10)
      assert.ok(await page.locator('#lista-boletos').innerText().then(text => text.includes('1000')))
      assert.equal(await page.getByRole('button', { name: 'Mostrar menos boletos' }).getAttribute('aria-expanded'), 'true')
      await page.getByRole('button', { name: 'Mostrar menos boletos' }).click()
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await noOverflow(page, width)
        if (width === 1440 || width === 390) await screenshot(page, `participante-${width}.png`)
      }
      assert.equal(await page.getByRole('link', { name: 'Ir al sorteo', exact: true }).getAttribute('href'), '/live')
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow')
    })

    await t.test('actualización automática de ganador y boletos al finalizar', async () => {
      snapshot.raffle.status = 'finished'
      snapshot.tickets[0].status = 'winner'
      snapshot.tickets[1].status = 'eliminated'
      snapshot.tickets[2].status = 'excluded'
      snapshot.prizes[0] = { ...snapshot.prizes[0], state: 'awarded', winnerTicketNumber: 7, winnerName: 'Patricia M.' }
      snapshot.prizes[1].state = 'unawarded'
      snapshot.awards = [snapshot.prizes[0]]
      await page.getByRole('heading', { name: 'Esta vez, la alegría es tuya.' }).waitFor()
      assert.equal(await page.getByText('¡Es tuyo!', { exact: true }).count(), 1)
      assert.equal(await page.locator('#lista-boletos').getByText('Participando', { exact: true }).count(), 0)
      assert.ok(await page.locator('#lista-boletos').getByText('Sin premio', { exact: true }).count() > 0)
      await noOverflow(page, 320)
      await screenshot(page, 'participante-ganador.png')
    })

    await t.test('un fallo temporal conserva la participación y se recupera', async () => {
      responseStatus = 503
      await page.getByRole('status').filter({ hasText: 'Reintentando' }).waitFor()
      assert.equal(await page.locator('#premios article').count(), 3)
      responseStatus = 200
      await page.getByRole('status').filter({ hasText: 'Reintentando' }).waitFor({ state: 'hidden' })
    })

    await t.test('estados vacíos, nombres largos y compras grandes', async () => {
      snapshot = fixture()
      snapshot.name = 'María' + 'a'.repeat(90)
      snapshot.raffle.name = 'La rifa familiar ' + 'especial'.repeat(14)
      snapshot.tickets = []
      snapshot.prizes = []
      await page.reload()
      await page.getByRole('heading', { name: 'Estamos preparando las sorpresas' }).waitFor()
      await noOverflow(page, 320)
      snapshot.tickets = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, status: 'active' }))
      await page.getByRole('button', { name: 'Ver los 50 boletos' }).click()
      assert.equal(await page.locator('#lista-boletos li').count(), 50)
      await noOverflow(page, 320)
    })

    await t.test('el enlace inválido permite reintentar sin pedir PIN', async () => {
      responseStatus = 404
      await page.reload()
      await page.getByRole('heading', { name: 'Enlace no disponible' }).waitFor()
      assert.equal(await page.locator('input').count(), 0)
      responseStatus = 200
      snapshot = fixture()
      await page.getByRole('button', { name: 'Volver a intentar' }).click()
      await page.getByRole('heading', { name: '¡Hola, Patricia!' }).waitFor()
      await noOverflow(page, 320)
    })

    assert.deepEqual(errors, [], 'No debe haber errores de JavaScript en la página')
  } finally { await browser.close() }
})

async function noOverflow(page, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Desbordamiento horizontal a ${width}px`)
}

async function screenshot(page, name) {
  if (!process.env.SCREENSHOT_DIR) return
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
  await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, name), fullPage: true })
}
