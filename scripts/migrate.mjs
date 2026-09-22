import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  await pool.query("INSERT INTO raffle (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
  await pool.query("INSERT INTO tickets (number) SELECT generate_series(1,1000) ON CONFLICT (number) DO NOTHING")
  console.log('Base de datos preparada')
} finally {
  await pool.end()
}
