import type { ElementType } from 'react'
import {
  Archive, BookMarked, Check, ChevronDown, ChevronRight, FileText,
  LibraryBig, Map, MapPin, Maximize2, MoreHorizontal, MousePointer2,
  Move, Plus, Upload,
} from 'lucide-react'
import { Button, PageHeader, PaneHead, SearchBox } from '../components/ui'

export function MapsPage() {
  return <div className="maps-page"><aside className="entity-pane"><PaneHead eyebrow="空间可视化" title="地图" />{[['临川城全图', '城市 · 8 个标记'], ['城北旧区', '区域 · 5 个标记'], ['沈家密道', '副本 · 4 个标记']].map((x, i) => <button className={'map-list-item ' + (i === 0 ? 'active' : '')} key={x[0]}><span><Map size={17} /></span><div><strong>{x[0]}</strong><small>{x[1]}</small></div><ChevronRight size={13} /></button>)}</aside><section className="map-main"><div className="map-head"><div><label>城市地图</label><strong>临川城全图</strong></div><span><Check size={12} />预览</span><Button>编辑地图信息</Button></div><div className="map-body"><div className="canvas-wrap"><div className="floating-tools"><button className="active"><MousePointer2 size={14} />选择</button><button><MapPin size={14} />标记</button><button><Move size={14} />路线</button><i /><button><Maximize2 size={14} /></button></div><div className="visual-map"><i className="map-river r1" /><i className="map-river r2" /><em className="district d1">城北</em><em className="district d2">长街</em><em className="district d3">水巷</em><Marker cls="p1" label="归雁客栈" /><Marker cls="p2" label="临川书院" /><Marker cls="p3" label="无名渡口" /><Marker cls="p4 active" label="沈家旧宅" /><Marker cls="p5" label="钟楼" /></div></div></div></section></div>
}

function Marker({ cls, label }: { cls: string; label: string }) {
  return <span className={'marker ' + cls}><i><MapPin size={12} fill="currentColor" /></i><strong>{label}</strong></span>
}

export function LibraryPage() {
  const items: [string, string, string, string, ElementType][] = [['《故事》', '罗伯特·麦基', '写作技法', '关于场景转折与价值变化的笔记', BookMarked], ['江南城镇建筑资料', '本地 TXT 导入', '世界观素材', '水巷、石桥、沿街建筑的结构参考', FileText], ['雨夜叙事的空间感', '个人笔记', '氛围描写', '雨声、灯光与视线受阻的写法整理', Archive]]
  return <div className="library-page"><aside><div className="library-brand"><LibraryBig size={20} /><span><strong>参考资料库</strong><small>预览模式</small></span></div><nav><button className="active"><LibraryBig size={15} />全部资料<i>38</i></button><button><BookMarked size={15} />书籍<i>12</i></button><button><FileText size={15} />文本摘录<i>18</i></button><button><Archive size={15} />个人笔记<i>8</i></button></nav><button className="import-card"><Upload size={17} /><span><strong>导入 TXT 资料</strong><small>单个文件不超过 2MB</small></span></button></aside><section><PageHeader eyebrow="本地知识库" title="全部资料" desc="这些内容可以作为 AI 生成时的可选参考。" actions={<Button kind="primary"><Plus size={14} />添加资料</Button>} /><div className="library-toolbar"><SearchBox text="搜索标题、作者、摘要或正文…" /><Button>最近更新<ChevronDown size={12} /></Button></div>{items.map(x => { const Icon = x[4]; return <article className="source-row" key={x[0]}><span><Icon size={18} /></span><div><h3>{x[0]} <em>{x[2]}</em></h3><p>{x[3]}</p><small>{x[1]} · 预览数据</small></div><Button kind="ghost"><Plus size={13} />加入 AI 参考</Button><button><MoreHorizontal size={15} /></button></article> })}</section></div>
}
