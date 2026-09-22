import { NextRequest, NextResponse } from 'next/server'
import { randomInt, randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { pool, lockedRaffle } from '@/lib/db'
import { getDashboard, getDrawSnapshot, getParticipantSnapshot } from '@/lib/state'
import { ApiError, assert, audit, apiFailure, checkOrigin, cleanName, getSession, hashToken, json, normalizePhone, randomToken, requireSession } from '@/lib/common'
import { beginGoogleOAuth, finishGoogleOAuth } from '@/lib/google-oauth'
import { loginWithPin } from '@/lib/auth'
import { getSheetsStatus, requestSheetsSync } from '@/lib/sheets'
import { readJson, textName, ticketNumber, price, id } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ parts: string[] }> }


export async function GET(req: NextRequest, context: Context) {
  try { return await handleGet(req, (await context.params).parts) } catch (error) { return apiFailure(error) }
}
export async function POST(req: NextRequest, context: Context) {
  try { checkOrigin(req); return await handlePost(req, (await context.params).parts) } catch (error) { return apiFailure(error) }
}
export async function PATCH(req: NextRequest, context: Context) {
  try { checkOrigin(req); return await handlePatch(req, (await context.params).parts) } catch (error) { return apiFailure(error) }
}
export async function DELETE(req: NextRequest, context: Context) {
  try { checkOrigin(req); return await handleDelete(req, (await context.params).parts) } catch (error) { return apiFailure(error) }
}

async function handleGet(req: NextRequest, parts: string[]) {
  const path = parts.join('/')
  if (path === 'admin/sheets/oauth/callback') return finishGoogleOAuth(req)
  if (path === 'auth/me') {
    const session = await getSession(req)
    return json(session ? { role: session.role, vendorId: session.vendorId } : null)
  }
  if (path === 'vendors') {
    await requireSession(req, 'seller')
    const result = await pool.query('SELECT id,name,quota FROM vendors WHERE active=true ORDER BY name')
    return json(result.rows)
  }
  if (path === 'state') return json(await getDashboard(await requireSession(req)))
  if (path === 'admin/sheets') {
    await requireSession(req, 'admin')
    return json(await getSheetsStatus())
  }
  if (path === 'admin/audit') {
    await requireSession(req, 'admin')
    const result = await pool.query(`SELECT a.id,a.action,a.details,a.created_at,a.actor_role,v.name AS actor_name
      FROM audit a LEFT JOIN vendors v ON v.id=a.actor_vendor_id ORDER BY a.id DESC LIMIT 200`)
    return json(result.rows)
  }
  if (path === 'public/draw') return json(await getDrawSnapshot())
  if (parts[0] === 'public' && parts[1] === 'participant' && parts.length === 3) {
    return json(await getParticipantSnapshot(parts[2]))
  }
  if (path === 'participants/lookup') {
    await requireSession(req, 'seller')
    const phone = normalizePhone(req.nextUrl.searchParams.get('phone') ?? '')
    const result = await pool.query('SELECT name,share_token FROM participants WHERE phone=$1', [phone])
    return json(result.rows[0] ?? null)
  }
  if (parts[0] === 'images' && parts.length === 2) {
    const file = parts[1]
    assert(/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(file), 404, 'Imagen no encontrada.')
    let content: Buffer
    try { content = await readFile(join(process.cwd(), 'uploads', file)) }
    catch { throw new ApiError(404, 'Imagen no encontrada.') }
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return new NextResponse(new Uint8Array(content), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' } })
  }
  throw new ApiError(404, 'Página no encontrada.')
}

async function handlePost(req: NextRequest, parts: string[]) {
  const path = parts.join('/')
  if (path === 'admin/sheets/oauth/start') return beginGoogleOAuth(req)
  if (path === 'auth/login') return loginWithPin(req)
  if (path === 'admin/sheets/sync') {
    await requireSession(req, 'admin')
    return json(await requestSheetsSync(), 202)
  }
  if (path === 'auth/logout') {
    const session = await getSession(req)
    if (session) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [session.tokenHash])
    const response = json({ ok: true })
    response.cookies.set('rf_session', '', { path: '/', maxAge: 0 })
    return response
  }
  if (path === 'auth/select') {
    const session = await requireSession(req, 'seller')
    const input = await readJson(req, z.object({ vendorId: id }))
    const result = await pool.query('UPDATE sessions SET vendor_id=$1 WHERE token_hash=$2 AND EXISTS (SELECT 1 FROM vendors WHERE id=$1 AND active=true) RETURNING vendor_id', [input.vendorId, session.tokenHash])
    assert(result.rowCount, 404, 'Vendedor no encontrado o inactivo.')
    return json({ vendorId: input.vendorId })
  }
  if (path === 'vendors') {
    const session = await requireSession(req, 'seller')
    const input = await readJson(req, z.object({ name: textName }))
    const result = await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'El registro de vendedores está cerrado.')
      const name = cleanName(input.name, 'El nombre')
      const created = await client.query<{ id: number }>('INSERT INTO vendors (name) VALUES ($1) RETURNING id', [name])
      await audit(client, session, 'vendor.created', { vendorId: created.rows[0].id, name })
      await client.query('UPDATE sessions SET vendor_id=$1 WHERE token_hash=$2', [created.rows[0].id, session.tokenHash])
      return created.rows[0]
    })
    return json(result, 201)
  }
  if (path === 'sales') return createSale(req)
  if (path === 'admin/start') return startDraw(req)
  if (path === 'admin/draw') return drawNext(req)
  if (path === 'admin/prizes') return createPrize(req)
  if (path === 'admin/upload') return uploadImage(req)
  if (parts[0] === 'admin' && parts[1] === 'participants' && parts[3] === 'token' && parts.length === 4) {
    const session = await requireSession(req, 'admin')
    const participantId = id.parse(parts[2])
    const token = randomToken()
    await lockedRaffle(async client => {
      const result = await client.query('UPDATE participants SET share_token=$1 WHERE id=$2 RETURNING id', [token, participantId])
      assert(result.rowCount, 404, 'Participante no encontrado.')
      await audit(client, session, 'participant.token_renewed', { participantId })
    })
    return json({ shareToken: token })
  }
  if (parts[0] === 'admin' && parts[1] === 'sales' && parts[3] === 'reassign' && parts.length === 4) {
    return reassignSale(req, id.parse(parts[2]))
  }
  throw new ApiError(404, 'Página no encontrada.')
}

async function createSale(req: NextRequest) {
  const session = await requireSession(req, 'seller')
  assert(session.vendorId, 403, 'Selecciona tu perfil de vendedor.')
  const input = await readJson(req, z.object({
    requestId: z.uuid(),
    participant: z.object({ name: textName, phone: z.string().min(8).max(25) }),
    items: z.array(z.object({ number: ticketNumber, priceCents: price })).min(1).max(1000),
  }))
  const phone = normalizePhone(input.participant.phone)
  const name = cleanName(input.participant.name)
  const numbers = input.items.map(item => item.number)
  assert(new Set(numbers).size === numbers.length, 400, 'La selección contiene números repetidos.')
  const payloadHash = createHash('sha256').update(JSON.stringify({ vendorId: session.vendorId, phone, name, items: [...input.items].sort((a, b) => a.number - b.number) })).digest('hex')
  const result = await lockedRaffle(async (client, status) => {
    const existing = await client.query<{ id: number; payload_hash: string; share_token: string }>(`
      SELECT s.id,s.payload_hash,p.share_token FROM sales s JOIN participants p ON p.id=s.participant_id WHERE s.request_id=$1`, [input.requestId])
    if (existing.rows[0]) {
      assert(existing.rows[0].payload_hash === payloadHash, 409, 'Esa solicitud ya se usó para una venta diferente.')
      return { saleId: existing.rows[0].id, shareToken: existing.rows[0].share_token, duplicate: true }
    }
    assert(status === 'open', 409, 'Las ventas están cerradas.')
    const vendor = await client.query<{ quota: number; active: boolean }>('SELECT quota,active FROM vendors WHERE id=$1', [session.vendorId])
    assert(vendor.rows[0]?.active, 403, 'Vendedor inactivo.')
    const sold = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.vendor_id=$1 AND si.canceled_at IS NULL`, [session.vendorId])
    assert(sold.rows[0].count + input.items.length <= vendor.rows[0].quota, 409, 'La venta supera tu cupo disponible.')
    const taken = await client.query<{ ticket_number: number }>('SELECT ticket_number FROM sale_items WHERE canceled_at IS NULL AND ticket_number=ANY($1::int[])', [numbers])
    assert(taken.rowCount === 0, 409, `Estos números ya se vendieron: ${taken.rows.map(row => row.ticket_number).join(', ')}.`)
    const participant = await client.query<{ id: number; share_token: string }>(`
      INSERT INTO participants (name,phone,share_token) VALUES ($1,$2,$3)
      ON CONFLICT (phone) DO UPDATE SET phone=excluded.phone RETURNING id,share_token`, [name, phone, randomToken()])
    const sale = await client.query<{ id: number }>(`
      INSERT INTO sales (vendor_id,participant_id,request_id,payload_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
      [session.vendorId, participant.rows[0].id, input.requestId, payloadHash])
    for (const item of input.items) {
      await client.query('INSERT INTO sale_items (sale_id,ticket_number,price_cents) VALUES ($1,$2,$3)', [sale.rows[0].id, item.number, item.priceCents])
    }
    await client.query('UPDATE vendors SET last_price_cents=$1 WHERE id=$2', [input.items.at(-1)!.priceCents, session.vendorId])
    await audit(client, session, 'sale.created', { saleId: sale.rows[0].id, numbers, participantId: participant.rows[0].id })
    return { saleId: sale.rows[0].id, shareToken: participant.rows[0].share_token, duplicate: false }
  })
  return json(result, result.duplicate ? 200 : 201)
}

async function startDraw(req: NextRequest) {
  const session = await requireSession(req, 'admin')
  await lockedRaffle(async (client, status) => {
    assert(status === 'open', 409, 'El sorteo ya comenzó.')
    const prizes = await client.query<{ draw_count: number }>('SELECT draw_count FROM prizes ORDER BY sort_order,id LIMIT 1')
    assert(prizes.rows[0], 409, 'Agrega al menos un premio.')
    const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM sale_items WHERE canceled_at IS NULL')
    assert(count.rows[0].count > 0, 409, 'No hay boletos vendidos.')
    assert(count.rows[0].count >= prizes.rows[0].draw_count, 409, 'El primer premio requiere más boletos de los vendidos. Reduce sus extracciones.')
    await client.query("UPDATE raffle SET status='drawing' WHERE id=1")
    await audit(client, session, 'raffle.started', { soldCount: count.rows[0].count })
  })
  return json(await getDrawSnapshot())
}

async function drawNext(req: NextRequest) {
  const session = await requireSession(req, 'admin')
  const input = await readJson(req, z.object({ requestId: z.uuid(), prizeId: id, expectedOrdinal: z.number().int().min(1).max(1000) }))
  await lockedRaffle(async (client, status) => {
    const duplicate = await client.query('SELECT id FROM extractions WHERE request_id=$1', [input.requestId])
    if (duplicate.rowCount) return
    assert(status === 'drawing', 409, 'El sorteo no está activo.')
    const pending = await client.query('SELECT id FROM extractions WHERE revealed_at>now() LIMIT 1')
    assert(!pending.rowCount, 409, 'Espera a que termine la animación anterior.')
    const prizeResult = await client.query<{ id: number; draw_count: number; state: string }>(`
      SELECT id,draw_count,state FROM prizes WHERE state IN ('pending','active') ORDER BY sort_order,id LIMIT 1`)
    const prize = prizeResult.rows[0]
    assert(prize, 409, 'Ya no hay premios pendientes.')
    assert(prize.id === input.prizeId, 409, 'Continúa con el premio actual.')
    const progress = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM extractions WHERE prize_id=$1', [prize.id])
    const ordinal = progress.rows[0].count + 1
    assert(ordinal === input.expectedOrdinal, 409, 'La pantalla cambió. Actualízala antes de continuar.')
    const candidates = await client.query<{ ticket_number: number; participant_id: number }>(`
      SELECT si.ticket_number,s.participant_id FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE si.canceled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.ticket_number=si.ticket_number)
        AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.kind='winner' AND e.participant_id=s.participant_id)
      ORDER BY si.ticket_number`)
    if (candidates.rowCount === 0) {
      await client.query("UPDATE prizes SET state='unawarded' WHERE state IN ('pending','active')")
      await client.query("UPDATE raffle SET status='finished' WHERE id=1")
      await audit(client, session, 'raffle.exhausted', {})
      return
    }
    assert(candidates.rows.length >= prize.draw_count - progress.rows[0].count, 409,
      'No hay suficientes boletos elegibles. Reduce las extracciones de este premio.')
    const chosen = candidates.rows[randomInt(candidates.rows.length)]
    const kind = ordinal === prize.draw_count ? 'winner' : 'eliminated'
    await client.query(`
      INSERT INTO extractions (prize_id,ordinal,ticket_number,participant_id,kind,request_id,revealed_at)
      VALUES ($1,$2,$3,$4,$5,$6,now()+interval '4 seconds')`,
      [prize.id, ordinal, chosen.ticket_number, chosen.participant_id, kind, input.requestId])
    if (kind === 'winner') {
      await client.query("UPDATE prizes SET state='awarded',winner_participant_id=$1,winner_ticket_number=$2 WHERE id=$3",
        [chosen.participant_id, chosen.ticket_number, prize.id])
      const remaining = await client.query("SELECT id FROM prizes WHERE state IN ('pending','active') LIMIT 1")
      if (!remaining.rowCount) await client.query("UPDATE raffle SET status='finished' WHERE id=1")
    } else if (prize.state === 'pending') {
      await client.query("UPDATE prizes SET state='active' WHERE id=$1", [prize.id])
    }
    await audit(client, session, 'draw.extracted', { prizeId: prize.id, ordinal, ticketNumber: chosen.ticket_number, kind })
  })
  return json(await getDrawSnapshot())
}

async function createPrize(req: NextRequest) {
  const session = await requireSession(req, 'admin')
  const input = await readJson(req, z.object({
    title: textName, description: z.string().max(1000).default(''),
    imagePath: z.string().regex(/^\/api\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/).nullable().optional(),
    drawCount: z.number().int().min(1).max(1000).default(5),
  }))
  const created = await lockedRaffle(async (client, status) => {
    assert(status === 'open', 409, 'El catálogo de premios ya está cerrado.')
    const result = await client.query<{ id: number }>(`
      INSERT INTO prizes (title,description,image_path,draw_count,sort_order)
      VALUES ($1,$2,$3,$4,(SELECT coalesce(max(sort_order),0)+1 FROM prizes)) RETURNING id`,
      [cleanName(input.title, 'El título'), input.description.trim(), input.imagePath ?? null, input.drawCount])
    await audit(client, session, 'prize.created', { prizeId: result.rows[0].id })
    return result.rows[0]
  })
  return json(created, 201)
}

async function uploadImage(req: NextRequest) {
  await requireSession(req, 'admin')
  const form = await req.formData()
  const file = form.get('file')
  assert(file instanceof File, 400, 'Selecciona una imagen.')
  assert(file.size > 0 && file.size <= 5_000_000, 400, 'La imagen debe ocupar menos de 5 MB.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : null
  assert(ext, 400, 'Usa una imagen PNG, JPG o WebP.')
  const directory = join(process.cwd(), 'uploads')
  await mkdir(directory, { recursive: true })
  const name = `${randomUUID()}.${ext}`
  await writeFile(join(directory, name), Buffer.from(await file.arrayBuffer()))
  return json({ path: `/api/images/${name}` }, 201)
}

async function reassignSale(req: NextRequest, saleId: number) {
  const session = await requireSession(req, 'admin')
  const input = await readJson(req, z.object({ name: textName, phone: z.string().min(8).max(25) }))
  const phone = normalizePhone(input.phone)
  const name = cleanName(input.name)
  const result = await lockedRaffle(async (client, status) => {
    assert(status === 'open', 409, 'Las correcciones están cerradas.')
    const sale = await client.query<{ participant_id: number }>('SELECT participant_id FROM sales WHERE id=$1', [saleId])
    assert(sale.rows[0], 404, 'Venta no encontrada.')
    const participant = await client.query<{ id: number }>(`
      INSERT INTO participants (name,phone,share_token) VALUES ($1,$2,$3)
      ON CONFLICT (phone) DO UPDATE SET phone=excluded.phone RETURNING id`, [name, phone, randomToken()])
    await client.query('UPDATE sales SET participant_id=$1 WHERE id=$2', [participant.rows[0].id, saleId])
    await audit(client, session, 'sale.reassigned', { saleId, from: sale.rows[0].participant_id, to: participant.rows[0].id })
    return { participantId: participant.rows[0].id }
  })
  return json(result)
}

async function handlePatch(req: NextRequest, parts: string[]) {
  const session = await requireSession(req, 'admin')
  if (parts.join('/') === 'admin/raffle') {
    const input = await readJson(req, z.object({ name: textName }))
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'El sorteo ya comenzó.')
      const name = cleanName(input.name, 'El nombre de la rifa')
      await client.query('UPDATE raffle SET name=$1 WHERE id=1', [name])
      await audit(client, session, 'raffle.renamed', { name })
    })
    return json({ ok: true })
  }
  if (parts[0] === 'admin' && parts[1] === 'vendors' && parts.length === 3) {
    const vendorId = id.parse(parts[2])
    const input = await readJson(req, z.object({
      name: textName.optional(), quota: z.number().int().min(0).max(1000).optional(), active: z.boolean().optional(),
    }).refine(x => Object.keys(x).length > 0))
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'Los cupos ya están cerrados.')
      const vendor = await client.query<{ quota: number }>('SELECT quota FROM vendors WHERE id=$1', [vendorId])
      assert(vendor.rows[0], 404, 'Vendedor no encontrado.')
      if (input.quota !== undefined) {
        const sold = await client.query<{ count: number }>(`
          SELECT count(*)::int AS count FROM sale_items si JOIN sales s ON s.id=si.sale_id
          WHERE s.vendor_id=$1 AND si.canceled_at IS NULL`, [vendorId])
        assert(input.quota >= sold.rows[0].count, 409, 'El cupo no puede ser menor que los boletos ya vendidos.')
      }
      await client.query('UPDATE vendors SET name=coalesce($1,name),quota=coalesce($2,quota),active=coalesce($3,active) WHERE id=$4',
        [input.name === undefined ? null : cleanName(input.name), input.quota ?? null, input.active ?? null, vendorId])
      await audit(client, session, 'vendor.updated', { vendorId, ...input })
    })
    return json({ ok: true })
  }
  if (parts[0] === 'admin' && parts[1] === 'prizes' && parts.length === 3) {
    const prizeId = id.parse(parts[2])
    const input = await readJson(req, z.object({
      title: textName.optional(), description: z.string().max(1000).optional(),
      imagePath: z.string().regex(/^\/api\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/).nullable().optional(),
      drawCount: z.number().int().min(1).max(1000).optional(),
      sortOrder: z.number().int().min(1).max(1000).optional(),
    }).refine(x => Object.keys(x).length > 0))
    await lockedRaffle(async (client, status) => {
      const prize = await client.query<{ state: string }>('SELECT state FROM prizes WHERE id=$1', [prizeId])
      assert(prize.rows[0], 404, 'Premio no encontrado.')
      assert(prize.rows[0].state === 'pending', 409, 'Este premio ya comenzó.')
      assert(status === 'open' || Object.keys(input).every(key => key === 'drawCount'), 409, 'Después de iniciar el sorteo solo puedes ajustar las extracciones de premios pendientes.')
      await client.query(`UPDATE prizes SET title=coalesce($1,title),description=coalesce($2,description),
        image_path=CASE WHEN $3::boolean THEN $4 ELSE image_path END,
        draw_count=coalesce($5,draw_count),sort_order=coalesce($6,sort_order) WHERE id=$7`,
        [input.title ? cleanName(input.title, 'El título') : null, input.description ?? null,
          input.imagePath !== undefined, input.imagePath ?? null, input.drawCount ?? null, input.sortOrder ?? null, prizeId])
      await audit(client, session, 'prize.updated', { prizeId, ...input })
    })
    return json({ ok: true })
  }
  if (parts[0] === 'admin' && parts[1] === 'items' && parts.length === 3) {
    const itemId = id.parse(parts[2])
    const input = await readJson(req, z.object({ priceCents: price }))
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'Las correcciones están cerradas.')
      const previous = await client.query<{ price_cents: number; ticket_number: number }>('SELECT price_cents,ticket_number FROM sale_items WHERE id=$1 AND canceled_at IS NULL', [itemId])
      assert(previous.rows[0], 404, 'Boleto vendido no encontrado.')
      const result = await client.query<{ price_cents: number }>('UPDATE sale_items SET price_cents=$1 WHERE id=$2 AND canceled_at IS NULL RETURNING price_cents', [input.priceCents, itemId])
      assert(result.rowCount, 404, 'Boleto vendido no encontrado.')
      await audit(client, session, 'item.price_updated', { itemId, number: previous.rows[0].ticket_number, fromCents: previous.rows[0].price_cents, toCents: input.priceCents })
    })
    return json({ ok: true })
  }
  if (parts[0] === 'admin' && parts[1] === 'participants' && parts.length === 3) {
    const participantId = id.parse(parts[2])
    const input = await readJson(req, z.object({ name: textName.optional(), phone: z.string().min(8).max(25).optional() }).refine(x => Object.keys(x).length > 0))
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'Las correcciones están cerradas.')
      const result = await client.query('UPDATE participants SET name=coalesce($1,name),phone=coalesce($2,phone) WHERE id=$3 RETURNING id',
        [input.name ? cleanName(input.name) : null, input.phone ? normalizePhone(input.phone) : null, participantId])
      assert(result.rowCount, 404, 'Participante no encontrado.')
      await audit(client, session, 'participant.updated', { participantId, ...input })
    })
    return json({ ok: true })
  }
  throw new ApiError(404, 'Página no encontrada.')
}

async function handleDelete(req: NextRequest, parts: string[]) {
  const session = await requireSession(req, 'admin')
  if (parts[0] === 'admin' && parts[1] === 'items' && parts.length === 3) {
    const itemId = id.parse(parts[2])
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'Las anulaciones están cerradas.')
      const result = await client.query<{ ticket_number: number }>('UPDATE sale_items SET canceled_at=now() WHERE id=$1 AND canceled_at IS NULL RETURNING ticket_number', [itemId])
      assert(result.rows[0], 404, 'Boleto vendido no encontrado.')
      await audit(client, session, 'item.canceled', { itemId, number: result.rows[0].ticket_number })
    })
    return json({ ok: true })
  }
  if (parts[0] === 'admin' && parts[1] === 'prizes' && parts.length === 3) {
    const prizeId = id.parse(parts[2])
    await lockedRaffle(async (client, status) => {
      assert(status === 'open', 409, 'El catálogo de premios ya está cerrado.')
      const result = await client.query('DELETE FROM prizes WHERE id=$1 AND state=$2 RETURNING id', [prizeId, 'pending'])
      assert(result.rowCount, 404, 'Premio no encontrado.')
      await audit(client, session, 'prize.deleted', { prizeId })
    })
    return json({ ok: true })
  }
  throw new ApiError(404, 'Página no encontrada.')
}
