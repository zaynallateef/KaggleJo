// Real PostgreSQL behavior in an isolated in-memory PGlite database. No network.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
let assertions = 0
const check = (condition, message) => { assert.ok(condition, message); assertions++ }
const denied = async (sql, params = []) => {
  await assert.rejects(db.query(sql, params), error => error.code === '42501')
  assertions++
}
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(await readFile(new URL('../supabase/migrations/20261102122627_community.sql', import.meta.url), 'utf8'))
  await db.exec('set role anon')
  const read = async () => (await db.query('select public.kagglejo_directory() as data')).rows[0].data
  check((await read()).snapshot === null, 'An unpublished database must not invent a snapshot.')
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    for (const table of ['snapshots', 'memberships', 'nominations', 'submission_limits']) {
      await denied(`select * from public.kagglejo_${table}`)
      await denied(`delete from public.kagglejo_${table}`)
    }
    await denied('select public.kagglejo_publish($1::jsonb)', ['{}'])
    await denied("insert into public.kagglejo_memberships(username,kaggle_id,display_name,city,evidence_url,review_basis,review_note) values('fake_member',1,'Fake','Amman','https://www.kaggle.com/fake_member','public_profile','Unreviewed attempt')")
  }
  await db.exec('set role anon')
  const nominate = (name, city = 'Amman', url = `https://www.kaggle.com/${name}`, confirmed = true) =>
    db.query('select public.kagglejo_nominate($1,$2,$3,$4) as data', [name, city, url, confirmed])
  for (const args of [['bad!', 'Amman'], ['valid_name', null], ['valid_name', 'Paris'], ['valid_name', 'Amman', 'https://evil.example/valid_name'], ['valid_name', 'Amman', 'https://www.kaggle.com/valid_name', false]]) {
    await assert.rejects(nominate(...args), error => error.code === '22023'); assertions++
  }
  check((await nominate('new_member')).rows[0].data.message.includes('submitted'), 'A valid submission is accepted.')
  check((await nominate('NEW_MEMBER', 'Amman', 'https://www.kaggle.com/NEW_MEMBER')).rows[0].data.message.includes('already'), 'Duplicate submissions are idempotent.')
  await db.exec('reset role')
  check((await db.query('select count(*)::int as n from public.kagglejo_nominations')).rows[0].n === 1, 'Only one pending row is persisted.')
  check((await db.query('select count from public.kagglejo_submission_limits')).rows[0].count === 1, 'Duplicates do not consume the daily allowance.')
  await db.exec('set role service_role')
  const snapshot = { schema_version: 1, meta: { mode: 'live', updated_at: '2026-01-02T00:00:00Z' },
    members: [{ id: 1, username: 'automatic_member', is_demo: 0 }], rankings: {}, profiles: {}, overviews: {} }
  const publish = value => db.query('select public.kagglejo_publish($1::jsonb) as data', [JSON.stringify(value)])
  check((await publish(snapshot)).rows[0].data.members === 1, 'The service role can publish an actual snapshot.')
  await assert.rejects(publish({ ...snapshot, meta: { mode: 'live', updated_at: '2026-01-01T00:00:00Z' } }), /newer data/); assertions++
  await assert.rejects(publish({ ...snapshot, members: [] }), /empty/); assertions++
  await assert.rejects(publish({ ...snapshot, members: [{ is_demo: 1 }] }), /demonstration/); assertions++
  await assert.rejects(publish({ ...snapshot, meta: { mode: 'live', updated_at: '2999-01-01T00:00:00Z' } }), /timestamp/); assertions++
  await db.query("insert into public.kagglejo_memberships(username,kaggle_id,display_name,city,evidence_url,review_basis,review_note,reviewed_at) values($1,2,'Public Member','Not specified',$2,'public_profile','PRIVATE_REVIEW_SENTINEL','2026-01-01T00:00:00Z')", ['reviewed_member', 'https://www.kaggle.com/reviewed_member'])
  await db.exec('set role anon')
  let directory = await read()
  check(directory.memberships.length === 1, 'Active memberships are public through the allowlisted RPC.')
  check(!JSON.stringify(directory).includes('PRIVATE_REVIEW_SENTINEL'), 'Private review notes are never exposed.')
  check(!JSON.stringify(directory).includes('new_member'), 'Pending nominations are never exposed.')
  check(directory.snapshot.meta.updated_at === snapshot.meta.updated_at, 'Failed publication preserves the previous snapshot.')
  const availability = async (available, changes = {}) => {
    await db.exec('set role service_role')
    await db.query('select public.kagglejo_publish($1::jsonb,$2::jsonb)', [JSON.stringify(snapshot), JSON.stringify([
      { username: 'reviewed_member', kaggle_id: 2, reviewed_at: '2026-01-01T00:00:00Z', available, ...changes },
    ])])
    await db.exec('set role anon')
  }
  await availability(false, { kaggle_id: 999 })
  check((await read()).memberships.length === 1, 'Availability checks cannot cross account IDs.')
  await availability(false, { reviewed_at: '2025-01-01T00:00:00Z' })
  check((await read()).memberships.length === 1, 'An old review cannot override a newer approval.')
  await availability(false)
  check((await read()).memberships.length === 0, 'A profile missing from public search is removed on publication.')
  await availability(true)
  check((await read()).memberships.length === 1, 'The next successful public lookup can restore an active approval.')
  await db.exec("set role service_role; update public.kagglejo_memberships set revoked_at=now(); update public.kagglejo_submission_limits set count=100; set role anon;")
  check((await read()).memberships.length === 0, 'Revocation changes the public response immediately.')
  await assert.rejects(nominate('over_limit'), /submission limit/); assertions++
  await db.exec('reset role')
  check((await db.query("select count(*)::int as n from public.kagglejo_nominations where username='over_limit'")).rows[0].n === 0, 'Rate-limited submissions do not persist.')
  console.log(`Supabase database checks passed (${assertions} assertions).`)
} finally {
  await db.close()
}
