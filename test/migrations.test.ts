import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import { getDB, rollbackLastMigration, runMigrations } from '../src/database.js'
import { setupTestServer, type TestServer } from './helpers/server.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

function hasTable(name: string): boolean {
  const row = getDB()
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(name)
  return row != null
}

function migrationCount(): number {
  const row = getDB().prepare('select count(*) as count from schema_migrations').get() as { count: number }
  return row.count
}

test('回滚最后一个迁移后可以重新前滚应用', () => {
  assert.equal(hasTable('simultaneous_turn_reservations'), true)

  const result = rollbackLastMigration()

  assert.deepEqual(result, { version: 6, name: 'simultaneous_turn_reservations' })
  assert.equal(hasTable('simultaneous_turn_reservations'), false)
  assert.equal(migrationCount(), 5)

  runMigrations()

  assert.equal(hasTable('simultaneous_turn_reservations'), true)
  assert.equal(migrationCount(), 6)
})

test('可以按逆序回滚全部迁移，回滚完返回 null', () => {
  const expected = [
    { version: 6, name: 'simultaneous_turn_reservations' },
    { version: 5, name: 'archived_games' },
    { version: 4, name: 'player_approval' },
    { version: 3, name: 'simultaneous_turn_operations' },
    { version: 2, name: 'simultaneous_turn_locks' },
    { version: 1, name: 'init_schema' },
  ]

  for (const migration of expected) {
    assert.deepEqual(rollbackLastMigration(), migration)
  }

  assert.equal(rollbackLastMigration(), null)
  assert.equal(hasTable('players'), false)
  assert.equal(hasTable('files_content'), false)
})
