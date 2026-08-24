import { indentParagraphs } from './textFormat.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('每个非空段落获得两个全角空格缩进', () => {
  assert.equal(
    indentParagraphs('断仙渊的风是活的。\n\n林尘睁开眼。'),
    '　　断仙渊的风是活的。\n\n　　林尘睁开眼。',
  )
})

test('已有缩进的段落不叠加，且归一为全角缩进', () => {
  assert.equal(indentParagraphs('　　已有缩进。\n  半角缩进。'), '　　已有缩进。\n　　半角缩进。')
})

test('空行与纯空白行保持原样', () => {
  assert.equal(indentParagraphs('第一段。\n\n \n第二段。'), '　　第一段。\n\n \n　　第二段。')
})

test('CRLF 换行统一为 LF', () => {
  assert.equal(indentParagraphs('甲段。\r\n\r\n乙段。'), '　　甲段。\n\n　　乙段。')
})

test('空文本安全', () => {
  assert.equal(indentParagraphs(''), '')
})
