import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  clearPasswordCache, hashPassword, isHashedPassword, verifyPassword, verifyPasswordCached,
} from '../src/password.js'

test('哈希结果可直接校验且每次都使用新盐', () => {
  const first = hashPassword('password123')
  const second = hashPassword('password123')

  assert.equal(isHashedPassword(first), true)
  assert.equal(first.startsWith('scrypt$'), true)
  assert.notEqual(first, second)
  assert.equal(verifyPassword('password123', first), true)
  assert.equal(verifyPassword('password124', first), false)
  assert.equal(verifyPassword('password123', second), true)
})

test('兼容旧库中的明文密码', () => {
  assert.equal(isHashedPassword('password123'), false)
  assert.equal(verifyPassword('password123', 'password123'), true)
  assert.equal(verifyPassword('password124', 'password123'), false)
  assert.equal(verifyPassword('', ''), false)
})

test('哈希参数非法或数据损坏时判定校验失败', () => {
  assert.equal(verifyPassword('password123', 'scrypt$32768$8$1$YWJj'), false)
  assert.equal(verifyPassword('password123', 'scrypt$x$8$1$YWJj$YWJj'), false)
  assert.equal(verifyPassword('password123', 'scrypt$1000$8$1$YWJj$YWJj'), false)
  assert.equal(verifyPassword('password123', `scrypt$${2 ** 20 + 1}$8$1$YWJj$YWJj`), false)
  assert.equal(verifyPassword('password123', 'scrypt$32768$64$1$YWJj$YWJj'), false)
  assert.equal(verifyPassword('password123', 'scrypt$32768$8$9$YWJj$YWJj'), false)
  assert.equal(verifyPassword('password123', 'scrypt$32768$8$1$$YWJj'), false)
  assert.equal(verifyPassword('password123', 'scrypt$32768$8$1$YWJj$'), false)
})

test('带缓存的校验在密码变更后失效', () => {
  clearPasswordCache()
  const stored = hashPassword('password123')

  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password123', stored), true)
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password123', stored), true)
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password124', stored), false)
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password124', stored), false)

  const changed = hashPassword('password124')
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password123', changed), false)
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password124', changed), true)

  clearPasswordCache()
  assert.equal(verifyPasswordCached('00000000-0000-0000-0000-00000000000a', 'password124', changed), true)
})
