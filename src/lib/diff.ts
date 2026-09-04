/** AI 改写的"代码审查式"差异标记（绿=新增 / 红=删除）。
 *
 *  用 diff-match-patch 做字符级 diff + semantic cleanup（对中文散文效果最好：
 *  相邻改动会被归并成语义块而不是零散单字），输出三种东西：
 *  - merged：审阅文本——删除内容保留在原位（供编辑器标红删除线）；
 *  - marks ：merged 里的 add/del 区间（喂给 WritingPage 的高亮背景层）；
 *  - clean ：采纳版——去掉全部 del 段后的最终正文。
 */
import { diff_match_patch } from 'diff-match-patch'

export type DiffMark = { start: number; end: number; type: 'add' | 'del' }

export function buildReviewDiff(orig: string, next: string): { merged: string; marks: DiffMark[]; clean: string } {
  const dmp = new diff_match_patch()
  const diffs = dmp.diff_main(orig, next)
  dmp.diff_cleanupSemantic(diffs)

  let merged = ''
  let clean = ''
  const raw: DiffMark[] = []
  for (const [op, text] of diffs) {
    if (op === 0) {
      merged += text
      clean += text
      continue
    }
    const start = merged.length
    merged += text
    raw.push({ start, end: start + text.length, type: op === 1 ? 'add' : 'del' })
    if (op === 1) clean += text
  }

  // cleanupSemantic 后仍可能产出相邻同类型段——合并成一个区间，
  // 减少背景层渲染的 span 数量。
  const marks: DiffMark[] = []
  for (const m of raw) {
    const last = marks[marks.length - 1]
    if (last && last.type === m.type && last.end === m.start) last.end = m.end
    else marks.push({ ...m })
  }
  return { merged, marks, clean }
}
