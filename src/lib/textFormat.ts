/** AI 采纳文本的排版规范化。 */

/** 网文排版惯例：每个自然段以两个全角空格（U+3000）开头。 */
export const PARAGRAPH_INDENT = '\u3000\u3000'

/** 给多段文本的每个非空段落加上段首缩进（两个全角空格）。
 *  - 已带缩进（全角/半角空格、Tab）的段落归一为标准缩进，不会叠加；
 *  - 空行保持原样（作为段落分隔符）；
 *  - \r\n 统一为 \n。
 *  用于 AI 生成稿"采纳并插入"时——模型输出的段落是顶格的，直接插入
 *  会让正文排版与写作惯例不一致。 */
export function indentParagraphs(text: string, indent: string = PARAGRAPH_INDENT): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => {
      const core = line.replace(/^[ \t\u3000]+/, '')
      return core ? indent + core : line
    })
    .join('\n')
}

/** 清洗 AI 输出的 Markdown 残留并归一稿面格式，供所有进入正文的路径使用：
 *  - 去 Markdown 记号：标题井号、加粗斜体星号与下划线、行首列表记号（横杠、
 *    星号、加号或数字编号）、引用块、水平分隔线、代码块围栏；
 *  - 引号统一为直角引号：”…” 与 “…” → 「…」，‘…’ → 『…』（只动同一行内
 *    成对的引号，落单的保持原样，避免误配对）；
 *  - 行尾空白清掉；3 个及以上连续换行压成一个空行（稿面惯例：段间至多一个空行）。
 *  规则刻意保守：正文里几乎不可能出现的记号才清，破折号（——）、省略号（……）、
 *  阿拉伯数字开头的段落等都不会被误伤。 */
export function normalizeAiText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // 代码块围栏整行移除（```lang / ~~~）
    .replace(/^[ \t]{0,3}(?:```|~~~)[^\n]*$/gm, '')
    // 标题记号：行首 1-6 个 # 后随内容，或整行只有 # 号
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*$/gm, '')
    // 引用块 "> " 与水平分隔线 --- / *** / ___（仅整行匹配）
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, '')
    // 加粗/斜体标记
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    // 行首列表记号（后随空白才算，"1987年""3.14"这类正文不受影响）
    .replace(/^[ \t]*(?:[-*+]|\d+[.、)])[ \t]+/gm, '')
    // 行尾空白（否则"空行"其实是空白行，空行压缩会漏）
    .replace(/[ \t]+$/gm, '')
    // 引号统一
    .replace(/"([^"\n]*)"/g, '「$1」')
    .replace(/“([^”\n]*)”/g, '「$1」')
    .replace(/‘([^’\n]*)’/g, '『$1』')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** AI 文本进正文稿面的完整处理：先清洗归一，再补段首缩进。
 *  侧栏采纳、右键内联续写/改写审阅、「整理排版」共用这一入口。 */
export function formatForManuscript(text: string): string {
  return indentParagraphs(normalizeAiText(text))
}
