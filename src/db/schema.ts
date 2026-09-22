import { pgTable, serial, integer, bigint, text, timestamp, boolean, uniqueIndex, index, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const raffle = pgTable('raffle', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull().default('Mi Rifa'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('single_raffle', sql`${t.id} = 1`), check('raffle_status', sql`${t.status} in ('open','drawing','finished')`)])

export const vendors = pgTable('vendors', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  quota: integer('quota').notNull().default(50),
  active: boolean('active').notNull().default(true),
  lastPriceCents: integer('last_price_cents'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('vendor_name_unique').on(sql`lower(${t.name})`), check('vendor_quota_nonnegative', sql`${t.quota} >= 0`)])

export const participants = pgTable('participants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  shareToken: text('share_token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tickets = pgTable('tickets', {
  number: integer('number').primaryKey(),
}, t => [check('ticket_range', sql`${t.number} between 1 and 1000`)])

export const sales = pgTable('sales', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  participantId: integer('participant_id').notNull().references(() => participants.id),
  requestId: text('request_id').notNull().unique(),
  payloadHash: text('payload_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('sales_vendor_idx').on(t.vendorId), index('sales_participant_idx').on(t.participantId)])

export const saleItems = pgTable('sale_items', {
  id: serial('id').primaryKey(),
  saleId: integer('sale_id').notNull().references(() => sales.id),
  ticketNumber: integer('ticket_number').notNull().references(() => tickets.number),
  priceCents: integer('price_cents').notNull(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
}, t => [
  uniqueIndex('active_ticket_unique').on(t.ticketNumber).where(sql`${t.canceledAt} is null`),
  index('sale_items_sale_idx').on(t.saleId),
  check('price_positive', sql`${t.priceCents} > 0`),
])

export const prizes = pgTable('prizes', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  imagePath: text('image_path'),
  sortOrder: integer('sort_order').notNull(),
  drawCount: integer('draw_count').notNull().default(5),
  state: text('state').notNull().default('pending'),
  winnerParticipantId: integer('winner_participant_id').references(() => participants.id),
  winnerTicketNumber: integer('winner_ticket_number').references(() => tickets.number),
}, t => [check('prize_count_positive', sql`${t.drawCount} > 0`), check('prize_state', sql`${t.state} in ('pending','active','awarded','unawarded')`)])

export const extractions = pgTable('extractions', {
  id: serial('id').primaryKey(),
  prizeId: integer('prize_id').notNull().references(() => prizes.id),
  ordinal: integer('ordinal').notNull(),
  ticketNumber: integer('ticket_number').notNull().references(() => tickets.number),
  participantId: integer('participant_id').notNull().references(() => participants.id),
  kind: text('kind').notNull(),
  requestId: text('request_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revealedAt: timestamp('revealed_at', { withTimezone: true }).notNull(),
}, t => [
  uniqueIndex('prize_ordinal_unique').on(t.prizeId, t.ordinal),
  uniqueIndex('extracted_ticket_unique').on(t.ticketNumber),
  uniqueIndex('winner_participant_unique').on(t.participantId).where(sql`${t.kind} = 'winner'`),
  check('extraction_kind', sql`${t.kind} in ('eliminated','winner')`),
])

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  credentialHash: text('credential_hash').notNull().default(''),
  role: text('role').notNull(),
  vendorId: integer('vendor_id').references(() => vendors.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('sessions_expiry_idx').on(t.expiresAt)])

export const audit = pgTable('audit', {
  id: serial('id').primaryKey(),
  actorRole: text('actor_role').notNull(),
  actorVendorId: integer('actor_vendor_id'),
  action: text('action').notNull(),
  details: jsonb('details').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const loginAttempts = pgTable('login_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('login_attempts_expiry_idx').on(t.expiresAt)])

export const sheetSync = pgTable('sheet_sync', {
  id: integer('id').primaryKey().default(1),
  revision: bigint('revision', { mode: 'bigint' }).notNull().default(sql`1`),
  syncedRevision: bigint('synced_revision', { mode: 'bigint' }).notNull().default(sql`0`),
  spreadsheetId: text('spreadsheet_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  syncing: boolean('syncing').notNull().default(false),
  failures: integer('failures').notNull().default(0),
  lastError: text('last_error'),
}, t => [check('single_sheet_sync', sql`${t.id} = 1`), check('sync_revision_order', sql`${t.syncedRevision} <= ${t.revision}`)])

export const googleConnection = pgTable('google_connection', {
  id: integer('id').primaryKey().default(1),
  clientId: text('client_id').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('single_google_connection', sql`${t.id} = 1`)])

export const googleOauthState = pgTable('google_oauth_state', {
  stateHash: text('state_hash').primaryKey(),
  browserHash: text('browser_hash').notNull(),
  sessionHash: text('session_hash').notNull().references(() => sessions.tokenHash, { onDelete: 'cascade' }),
  pinProof: text('pin_proof').notNull(),
  verifier: text('verifier').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
