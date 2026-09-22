import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@/db/schema'

const globalDb = globalThis as typeof globalThis & { rifaPool?: pg.Pool }

export const pool = globalDb.rifaPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
})
if (process.env.NODE_ENV !== 'production') globalDb.rifaPool = pool

export const db = drizzle(pool, { schema })

export async function lockedRaffle<T>(work: (client: pg.PoolClient, status: string) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ status: string }>('SELECT status FROM raffle WHERE id = 1 FOR UPDATE')
    if (!result.rows[0]) throw new Error('La rifa no está inicializada. Ejecuta las migraciones.')
    const value = await work(client, result.rows[0].status)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
