/** Parse the AI's strict "名称/分类/描述" output into a world-setting draft.
 * 纯函数（无 JSX/无运行时导入），供世界观页使用与 node:test 覆盖。 */
export function parseSettingDraft(text: string): { name: string; category: string; description: string } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const pick = (prefix: string) => {
    const line = lines.find(l => l.startsWith(prefix))
    return line ? line.slice(prefix.length).trim() : ''
  }
  let name = pick('名称：') || pick('名称:')
  let category = pick('分类：') || pick('分类:')
  let description = pick('描述：') || pick('描述:')
  // Fallbacks if the model didn't follow the strict format.
  if (!name) name = lines[0]?.slice(0, 40) || '未命名设定'
  if (!['世界规则', '势力分布', '历史背景', '法宝物品'].includes(category)) category = '世界规则'
  if (!description) description = lines.join('\n')
  return { name, category, description }
}
