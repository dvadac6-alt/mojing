/** 阿拉伯数字 → 汉字数字（文房序号用，如章节「十一」、卷「三」）。
 *  支持 1–9999；0 与负数原样返回（不应出现在序号场景）。 */
export function toCnNum(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 9999) return String(n)
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const units = ['', '十', '百', '千']
  const s = String(n)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i])
    const u = units[s.length - 1 - i]
    // 「一十」在首位省「一」（十、十一、十二…），其余位补零规则：
    // 中间出现的 0 用「零」占位且连续 0 只补一个。
    if (d === 0) {
      if (out && !out.endsWith('零') && i < s.length - 1 && Number(s.slice(i + 1)) > 0) out += '零'
    } else if (d === 1 && u === '十' && out === '') {
      out += '十'
    } else {
      out += digits[d] + u
    }
  }
  return out
}
