/** 章节正文的撤销/重做历史（快照式）。
 *
 *  浏览器原生 textarea 撤销只能覆盖手动输入——AI 流式插入、改写审阅、
 *  「整理排版」这类程序化 setDraft 会直接打断原生栈。这里以整章快照
 *  记录历史：打字按 700ms 去抖合并成一笔，程序化修改前显式提交一笔；
 *  快照附带光标位置（全局 offset），撤销/重做后恢复到当时的插入点。 */

export type Snapshot = { content: string; caret: number }

const MAX_SNAPSHOTS = 100

export class EditorHistory {
  private stack: Snapshot[] = []
  private index = -1

  /** 提交一帧快照；与栈顶内容相同则跳过（幂等，防止去抖与显式提交重叠、
   *  StrictMode 双调用的重复入栈）。caret 缺省用内容末尾。 */
  push(content: string, caret?: number) {
    const snap: Snapshot = { content, caret: caret ?? content.length }
    const top = this.stack[this.index]
    if (top && top.content === content) {
      top.caret = snap.caret // 光标以最新为准
      return
    }
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(snap)
    if (this.stack.length > MAX_SNAPSHOTS) this.stack.shift()
    this.index = this.stack.length - 1
  }

  /** 清空并落一个初始快照（切换章节 / 首次加载时）。 */
  reset(content: string, caret?: number) {
    this.stack = []
    this.index = -1
    this.push(content, caret)
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  undo(): Snapshot | null {
    if (!this.canUndo) return null
    return this.stack[--this.index]
  }

  redo(): Snapshot | null {
    if (!this.canRedo) return null
    return this.stack[++this.index]
  }
}
