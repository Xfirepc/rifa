import { z } from 'zod'
import { ApiError } from '@/lib/common'

export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let input: unknown
  try { input = await req.json() } catch { throw new ApiError(400, 'El contenido de la solicitud no es válido.') }
  const result = schema.safeParse(input)
  if (!result.success) throw new ApiError(400, result.error.issues[0]?.message ?? 'Datos inválidos.')
  return result.data
}

export const textName = z.string().min(2).max(100)
export const id = z.coerce.number().int().positive()
export const price = z.number().int().min(1).max(100_000_000)
export const ticketNumber = z.number().int().min(1).max(1000)
