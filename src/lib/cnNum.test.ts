import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCnNum } from './cnNum.ts'

test('个位', () => {
  assert.equal(toCnNum(1), '一')
  assert.equal(toCnNum(9), '九')
})

test('十位含「一十」省略', () => {
  assert.equal(toCnNum(10), '十')
  assert.equal(toCnNum(11), '十一')
  assert.equal(toCnNum(20), '二十')
  assert.equal(toCnNum(23), '二十三')
})

test('百位与补零', () => {
  assert.equal(toCnNum(100), '一百')
  assert.equal(toCnNum(105), '一百零五')
  assert.equal(toCnNum(110), '一百一十')
  assert.equal(toCnNum(123), '一百二十三')
})

test('千位与连续零', () => {
  assert.equal(toCnNum(1000), '一千')
  assert.equal(toCnNum(1001), '一千零一')
  assert.equal(toCnNum(1010), '一千零一十')
  assert.equal(toCnNum(2026), '二千零二十六')
})

test('越界与非法值原样返回', () => {
  assert.equal(toCnNum(0), '0')
  assert.equal(toCnNum(-3), '-3')
  assert.equal(toCnNum(10000), '10000')
})
