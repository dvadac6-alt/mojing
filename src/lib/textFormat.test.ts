import { formatForManuscript, indentParagraphs, normalizeAiText } from './textFormat.ts'
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

test('normalizeAiText 去除 Markdown 标题/加粗/列表/分隔线', () => {
  const raw = '## 第一章 终极任务\n\n**风**停了。\n\n- 他站起来。\n\n---\n1. 走出门。'
  assert.equal(normalizeAiText(raw), '第一章 终极任务\n\n风停了。\n\n他站起来。\n\n走出门。')
})

test('normalizeAiText 三连斜体与围栏行也能清干净', () => {
  assert.equal(normalizeAiText('***重要***'), '重要')
  assert.equal(normalizeAiText('```\n代码\n```'), '代码')
})

test('normalizeAiText 引号统一为直角引号，落单引号不动', () => {
  assert.equal(normalizeAiText('"你好。"他说。"再见。"'), '「你好。」他说。「再见。」')
  assert.equal(normalizeAiText('“外层‘内层’外层”'), '「外层『内层』外层」')
  assert.equal(normalizeAiText('“原来如此……她低声说'), '“原来如此……她低声说')
})

test('normalizeAiText 压缩连续空行至一个、去除行尾空白', () => {
  assert.equal(
    normalizeAiText('第一段。 \n\n\n\n第二段。\t\n\n   \n第三段。'),
    '第一段。\n\n第二段。\n\n第三段。',
  )
})

test('normalizeAiText 不误伤正常正文（破折号/省略号/数字与算式开头段）', () => {
  const raw = '——他停住了。\n1987年的夏天。\n三点二刻，3*4=12。'
  assert.equal(normalizeAiText(raw), raw)
})

test('normalizeAiText 空文本安全', () => {
  assert.equal(normalizeAiText(''), '')
})

test('formatForManuscript 全流程：清洗 Markdown 后补段首缩进', () => {
  const raw = '## 第一章\r\n\r\n风停了。\r\n\r\n\r\n"走了。"他说。'
  assert.equal(formatForManuscript(raw), '　　第一章\n\n　　风停了。\n\n　　「走了。」他说。')
})
