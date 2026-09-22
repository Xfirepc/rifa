import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1'
const screenshotDir = process.env.SCREENSHOT_DIR

test('vistas de vendedor, administrador y participantes en móvil', { timeout: 60_000 }, async () => {
  assert.ok(process.env.SELLER_PIN && process.env.ADMIN_PIN, 'Define las PIN de prueba.')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    await page.goto(base)
    await page.locator('#pin').fill(process.env.SELLER_PIN)
    await page.getByRole('button', { name: /Entrar a la rifa/ }).click()
    await page.getByRole('heading', { name: /Quién está vendiendo hoy/ }).waitFor()
    await page.locator('.profile-card').first().click()
    await page.getByRole('heading', { name: /Hola,/ }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Vista de vendedor desborda horizontalmente')
    assert.equal(await page.evaluate(async () => (await fetch('/api/admin/audit')).status), 403)
    await shot(page, 'vendedor-movil.png')
    await page.getByRole('button', { name: /Mis ventas/ }).click()
    await page.locator('.sale-card').first().waitFor()
    await page.getByRole('button', { name: 'Salir' }).click()
    await page.getByRole('button', { name: 'Administración' }).click()
    await page.locator('#pin').fill(process.env.ADMIN_PIN)
    await page.getByRole('button', { name: /Entrar a la rifa/ }).click()
    await page.getByRole('heading', { name: /Tu rifa, a tu manera/ }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Vista de administración desborda horizontalmente')
    const imageResult = await page.evaluate(async () => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9YK0cAAAAASUVORK5CYII='), char => char.charCodeAt(0))
      const form = new FormData()
      form.append('file', new File([bytes], 'premio.png', { type: 'image/png' }))
      const upload = await fetch('/api/admin/upload', { method: 'POST', body: form })
      const payload = await upload.json()
      const image = payload.path ? await fetch(payload.path) : null
      return { uploadStatus: upload.status, imageStatus: image?.status, type: image?.headers.get('content-type') }
    })
    assert.deepEqual(imageResult, { uploadStatus: 201, imageStatus: 200, type: 'image/png' })
    await shot(page, 'administracion-movil.png')
    const state = await page.evaluate(async () => (await fetch('/api/state')).json())
    assert.ok(state.items.length > 0)
    await page.locator('.admin-tabs button').filter({ hasText: 'Google Sheets' }).click()
    await page.getByRole('heading', { name: 'Tu copia en Google Sheets' }).waitFor()
    await page.getByRole('button', { name: 'Conectar Google', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Google Sheets desborda horizontalmente')
    await shot(page, 'google-sheets-movil.png')
    await page.locator('.admin-tabs button').filter({ hasText: 'Premios' }).click()
    await page.locator('.prize-editor').first().waitFor()
    await page.locator('.admin-tabs button').filter({ hasText: 'Actividad' }).click()
    await page.locator('.audit-entry').first().waitFor()
    await page.locator('.admin-tabs button').filter({ hasText: 'Sorteo' }).click()
    await page.locator('.draw-stage').waitFor()
    const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await publicPage.goto(`${base}/p/${state.items[0].share_token}`)
    await publicPage.getByRole('heading', { name: /Hola,/ }).waitFor()
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Vista de participante desborda horizontalmente')
    await shot(publicPage, 'participante-movil.png')
    await publicPage.goto(`${base}/live`)
    await publicPage.locator('.draw-stage').waitFor()
    await shot(publicPage, 'sorteo-movil.png')
  } finally { await browser.close() }
})

async function shot(page, name) {
  if (!screenshotDir) return
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({ path: join(screenshotDir, name), fullPage: true })
}
