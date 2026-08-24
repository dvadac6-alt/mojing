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
