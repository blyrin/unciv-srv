import assert from 'node:assert/strict'
import { afterEach, test } from 'vitest'
import {
  anonymizeIP, defaultIPRetentionDays, defaultIPStorageMode, getIPRetentionDays, getIPStorageMode, ipForLog,
  ipForStorage, ipForStorageOrUndefined, setIPRetentionDays, setIPStorageMode,
} from '../src/privacy.js'

afterEach(() => {
  setIPStorageMode(defaultIPStorageMode)
  setIPRetentionDays(defaultIPRetentionDays)
})

test('默认按网段匿名化，IPv4 保留 /24、IPv6 保留 /48', () => {
  assert.equal(defaultIPStorageMode, 'anonymized')
  assert.equal(getIPStorageMode(), 'anonymized')

  assert.equal(anonymizeIP('1.2.3.4'), '1.2.3.0')
  assert.equal(anonymizeIP('::ffff:1.2.3.4'), '1.2.3.0')
  assert.equal(anonymizeIP('2001:db8:1234:5678::1'), '2001:db8:1234::')
  assert.equal(anonymizeIP('2001:db8::'), '2001:db8:0::')
  assert.equal(anonymizeIP('2001:db8:1:2:3:4:5:6'), '2001:db8:1::')
})

test('无法识别的地址原样返回', () => {
  assert.equal(anonymizeIP('unknown'), 'unknown')
  assert.equal(anonymizeIP('1.2.3'), '1.2.3')
  assert.equal(anonymizeIP('1.2.3.999'), '1.2.3.999')
  assert.equal(anonymizeIP('2001:db8:1:2:3:4:5:6:7'), '2001:db8:1:2:3:4:5:6:7')
  assert.equal(anonymizeIP('2001:db8:1:2:3:4:5:6:7:8'), '2001:db8:1:2:3:4:5:6:7:8')
})

test('存储策略决定入库与日志里的 IP', () => {
  setIPStorageMode('full')
  assert.equal(ipForStorage('1.2.3.4'), '1.2.3.4')
  assert.equal(ipForLog('1.2.3.4'), '1.2.3.4')
  assert.equal(ipForStorage(''), null)
  assert.equal(ipForStorage(undefined), null)
  assert.equal(ipForLog(''), '')
  assert.equal(ipForStorageOrUndefined('1.2.3.4'), '1.2.3.4')

  setIPStorageMode('anonymized')
  assert.equal(ipForStorage('1.2.3.4'), '1.2.3.0')
  assert.equal(ipForLog('1.2.3.4'), '1.2.3.0')

  setIPStorageMode('none')
  assert.equal(ipForStorage('1.2.3.4'), null)
  assert.equal(ipForStorageOrUndefined('1.2.3.4'), undefined)
  assert.equal(ipForLog('1.2.3.4'), '')
  assert.equal(ipForLog(undefined), '')
})

test('保留天数不接受负数', () => {
  assert.equal(defaultIPRetentionDays, 30)
  setIPRetentionDays(7)
  assert.equal(getIPRetentionDays(), 7)
  setIPRetentionDays(-1)
  assert.equal(getIPRetentionDays(), 0)
  setIPRetentionDays(0)
  assert.equal(getIPRetentionDays(), 0)
})
