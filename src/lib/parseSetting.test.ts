import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSettingDraft } from './parseSetting.ts'

test('标准 名称/分类/描述 格式被正确解析', () => {
  const draft = parseSettingDraft('名称：俊峰镇\n分类：势力分布\n描述：朝廷押送囚犯的中转站。')
  assert.equal(draft.name, '俊峰镇')
  assert.equal(draft.category, '势力分布')
  assert.equal(draft.description, '朝廷押送囚犯的中转站。')
})

test('半角冒号同样支持', () => {
  const draft = parseSettingDraft('名称:雨夜\n分类:世界规则\n描述:三年不停的雨')
  assert.equal(draft.name, '雨夜')
  assert.equal(draft.category, '世界规则')
})

test('非法/缺失分类回退到 世界规则', () => {
  const draft = parseSettingDraft('名称：x\n分类：不存在的分类\n描述：d')
  assert.equal(draft.category, '世界规则')
})

test('模型不守格式时：首行作名称，全文作描述', () => {
  const draft = parseSettingDraft('某个设定标题\n第二行内容\n第三行内容')
  assert.equal(draft.name, '某个设定标题')
  assert.equal(draft.category, '世界规则')
  assert.equal(draft.description, '某个设定标题\n第二行内容\n第三行内容')
})

test('空输入回退到未命名设定', () => {
  const draft = parseSettingDraft('')
  assert.equal(draft.name, '未命名设定')
})
