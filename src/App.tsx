import { useState, type ElementType, type ReactNode } from 'react'
import {
  AlertTriangle, Archive, Bell, BookHeart, BookMarked, BookOpen, Bot, BrainCircuit,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CloudOff,
  Command, Database, Feather, FileClock, FilePlus2, FileText, Focus, GitBranch,
  Globe2, GripVertical, HardDrive, Import, LibraryBig, Map, MapPin, Maximize2, Minimize2,
  MoreHorizontal, Move, PanelLeftClose, PanelRightClose, PenLine, Plus, Redo2,
  Save, Search, Settings, ShieldCheck, Sparkles, Square, Tag, Trash2, Undo2,
  Upload, Users, WandSparkles, X, ZoomIn, ZoomOut, MousePointer2,
} from 'lucide-react'

type Page = 'projects' | 'overview' | 'writing' | 'outline' | 'characters' |
  'locations' | 'world' | 'threads' | 'maps' | 'library' | 'settings'

type Nav = { id: Page; label: string; icon: ElementType; count?: string }

const creationNav: Nav[] = [
  { id: 'overview', label: '作品概览', icon: BookHeart },
  { id: 'writing', label: '写作', icon: PenLine },
  { id: 'outline', label: '大纲', icon: GitBranch },
]
const dataNav: Nav[] = [
  { id: 'characters', label: '角色', icon: Users, count: '12' },
  { id: 'locations', label: '地点', icon: MapPin, count: '18' },
  { id: 'world', label: '世界观', icon: Globe2, count: '24' },
  { id: 'threads', label: '伏笔', icon: BrainCircuit, count: '7' },
  { id: 'maps', label: '地图', icon: Map, count: '3' },
]
const chapters = [
  ['01', '雨夜来客', '2,846'], ['02', '旧城的钟声', '3,124'],
  ['03', '无名渡口', '2,519'], ['04', '玉佩上的裂痕', '3,086'],
  ['05', '长街尽头', '642'], ['06', '未寄出的信', '0'],
]
const manuscript = [
  '雨落到第四更时，临川城最后一盏灯也灭了。',
  '沈砚站在檐下，掌心那枚旧玉佩被雨气浸得冰凉。裂纹从云纹中央一路延伸，像一条刚刚苏醒的河。他记得三年前离开故乡时，它还完好无损。',
  '街角传来木轮碾过青石的声音。',
  '一辆没有灯笼的马车停在客栈门前。车帘掀起一线，先伸出来的是一只苍白的手，指间夹着半封被火烧过的信。',
  '“沈公子，”车里的人说，“你等的答案，在城北。”',
  '沈砚没有动。他看见那封信残存的落款，忽然想起渡口老人临死前说过的话——不要相信在雨夜找到你的人。',
]
const people = [
  ['沈砚', '少阁主 · 主角', '#334f68', '寡言、克制，对三年前的灭门真相始终保持怀疑。'],
  ['苏晚照', '照影 · 女主角', '#9d6b62', '游走于各方势力之间的情报商，真实身份成谜。'],
  ['陆停云', '陆先生 · 重要配角', '#6c7250', '临川书院教习，温和表象之下藏着不为人知的旧事。'],
  ['谢无归', '北地刀 · 对手', '#6d5360', '来自北境的刀客，与沈家旧案有隐秘联系。'],
]
const threadGroups = [
  { title: '已埋下', tone: 'amber', cards: [['裂纹玉佩', '主线', '玉佩在雨夜突然出现裂纹，内部似乎封存着某种信息。'], ['客栈掌柜的左手', '细节', '掌柜始终用右手做事，左手藏在袖中。']] },
  { title: '已暗示', tone: 'orange', cards: [['无名渡口的旧碑', '支线', '碑文与沈家族谱中的缺页内容高度相似。']] },
  { title: '发展中', tone: 'blue', cards: [['三年前的雨夜', '主线', '多名角色对当夜的叙述存在明显冲突。'], ['苏晚照的真名', '支线', '她对“照影”这个名字表现出异常排斥。']] },
  { title: '已收束', tone: 'green', cards: [['渡口老人身份', '支线', '确认他曾是沈家账房，受命守护渡口密道。']] },
]

export default function App() {
  const [page, setPage] = useState<Page>('writing')
  const [collapsed, setCollapsed] = useState(false)
  const [assistant, setAssistant] = useState(true)
  const [command, setCommand] = useState(false)
  return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} />
      <div className="app-body">
        <Sidebar page={page} collapsed={collapsed} onPage={setPage} onCollapse={() => setCollapsed(!collapsed)} />
        <main className="stage">
          {page === 'projects' && <ProjectsPage onOpen={() => setPage('overview')} />}
          {page === 'overview' && <OverviewPage onWrite={() => setPage('writing')} />}
          {page === 'writing' && <WritingPage assistant={assistant} onAssistant={() => setAssistant(!assistant)} />}
          {page === 'outline' && <OutlinePage />}
          {page === 'characters' && <CharactersPage />}
          {page === 'locations' && <LocationsPage />}
          {page === 'world' && <WorldPage />}
          {page === 'threads' && <ThreadsPage />}
          {page === 'maps' && <MapsPage />}
          {page === 'library' && <LibraryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <StatusBar />
      {command && <CommandPalette onClose={() => setCommand(false)} onPage={(next) => { setPage(next); setCommand(false) }} />}
    </div>
  )
}

function TitleBar({ onCommand }: { onCommand: () => void }) {
  return <header className="titlebar">
    <span className="brand-icon"><Feather size={15} /></span><strong className="brand-name">墨境</strong>
    <nav className="native-menu"><button>文件</button><button>编辑</button><button>视图</button><button>帮助</button></nav>
    <button className="title-search" onClick={onCommand}><Search size={13} /><span>搜索作品、章节或命令</span><kbd>Ctrl K</kbd></button>
    <span className="title-context"><i />《雾隐长街》</span>
    <div className="window-actions"><button><Minimize2 size={13} /></button><button><Square size={11} /></button><button className="close"><X size={14} /></button></div>
  </header>
}

function Sidebar({ page, collapsed, onPage, onCollapse }: { page: Page; collapsed: boolean; onPage: (p: Page) => void; onCollapse: () => void }) {
  const items = (list: Nav[]) => list.map(({ id, label, icon: Icon, count }) =>
    <button key={id} title={collapsed ? label : ''} className={'nav-item ' + (page === id ? 'active' : '')} onClick={() => onPage(id)}>
      <Icon size={17} />{!collapsed && <><span>{label}</span>{count && <small>{count}</small>}</>}
    </button>)
  return <aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}>
    <button className="book-switch" onClick={() => onPage('projects')}><b>雾</b>{!collapsed && <><span><strong>雾隐长街</strong><small>悬疑 · 连载中</small></span><ChevronDown size={14} /></>}</button>
    <div className="nav-scroll">{!collapsed && <label>创作</label>}{items(creationNav)}{!collapsed && <label className="spaced">资料</label>}{items(dataNav)}</div>
    <div className="sidebar-foot">
      <button className={'nav-item ' + (page === 'library' ? 'active' : '')} onClick={() => onPage('library')}><LibraryBig size={17} />{!collapsed && <span>参考资料库</span>}</button>
      <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => onPage('settings')}><Settings size={17} />{!collapsed && <span>设置</span>}</button>
      <button className="nav-item" onClick={onCollapse}>{collapsed ? <ChevronRight size={17} /> : <PanelLeftClose size={17} />}{!collapsed && <span>收起侧栏</span>}</button>
    </div>
  </aside>
}

function StatusBar() {
  return <footer className="statusbar"><span><i><Check size={10} /></i> 本地数据库正常</span><span><HardDrive size={12} /> 上次备份：今天 09:30</span><b /><span><CloudOff size={12} /> 本地模式</span><span>UTF-8</span><span>UI Preview 0.1.0</span></footer>
}

function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: string; title: string; desc?: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <label>{eyebrow}</label>}<h1>{title}</h1>{desc && <p>{desc}</p>}</div>{actions && <aside>{actions}</aside>}</div>
}
const Button = ({ children, kind = 'secondary', onClick }: { children: ReactNode; kind?: string; onClick?:()=>void }) => <button className={'btn ' + kind} onClick={onClick}>{children}</button>

function ProjectsPage({ onOpen }: { onOpen: () => void }) {
  const projects = [['雾隐长街', '悬疑', '12.4 万', '62', 'ink'], ['向群星借一场雨', '科幻', '5.8 万', '34', 'blue'], ['山河旧梦录', '古言', '21.7 万', '88', 'clay']]
  return <Scroll>
    <PageHeader eyebrow="本地作品" title="我的作品" desc="所有原稿都保存在这台电脑的 SQLite 数据库中。" actions={<><Button><Import size={15} />导入 TXT</Button><Button kind="primary"><Plus size={15} />新建作品</Button></>} />
    <div className="project-toolbar"><SearchBox text="搜索作品…" /><div className="segments"><button className="active">最近编辑</button><button>全部作品</button><button>已完结</button></div></div>
    <div className="project-grid">
      <button className="new-project"><span><FilePlus2 size={23} /></span><strong>创建一部新小说</strong><small>从一个名字和想法开始</small></button>
      {projects.map(([title, genre, words, progress, tone]) => <article className="project-card" key={title} onClick={onOpen}>
        <div className={'cover ' + tone}><Feather size={25} /><span>{title.slice(0, 2)}</span></div>
        <div className="project-body"><div><em>{genre}</em><button><MoreHorizontal size={17} /></button></div><h2>{title}</h2><p>42 章 · {words}字 · 刚刚编辑</p><div className="progress"><i style={{ width: progress + '%' }} /></div><footer><span>创作进度</span><strong>{progress}%</strong></footer></div>
      </article>)}
    </div>
    <section className="backup-banner"><span><ShieldCheck size={22} /></span><div><strong>本地数据安全</strong><p>自动备份已开启，下次备份将在今天 21:30 创建。</p></div><Button kind="ghost">管理备份</Button></section>
  </Scroll>
}

function OverviewPage({ onWrite }: { onWrite: () => void }) {
  return <Scroll>
    <PageHeader eyebrow="作品概览" title="雾隐长街" desc="一场持续三年的雨，和一桩无人敢提起的旧案。" actions={<><Button>作品设置</Button><button className="btn primary" onClick={onWrite}><PenLine size={15} />继续写作</button></>} />
    <div className="metrics">
      <Metric icon={FileText} label="总字数" value="124,680" note="本周 +8,420" tone="ink" />
      <Metric icon={BookOpen} label="章节" value="42" note="已完成 36 章" tone="sage" />
      <Metric icon={BrainCircuit} label="未收束伏笔" value="7" note="其中 2 条主线" tone="amber" />
      <Metric icon={Feather} label="连续创作" value="16 天" note="今日 1,286 字" tone="clay" />
    </div>
    <div className="overview-grid">
      <section className="panel progress-panel"><PanelTitle title="创作进度" action="查看统计" /><div className="goal"><strong>124,680</strong><span>/ 200,000 字</span></div><div className="big-progress"><i /></div><div className="week-bars">{[48,76,42,88,66,92,58].map((h,i) => <span key={i}><i style={{ height: h + '%' }} /><small>{'一二三四五六日'[i]}</small></span>)}</div></section>
      <section className="panel"><PanelTitle title="需要留意" action="打开伏笔看板" /><div className="attention"><Attention icon={AlertTriangle} title="“三年前的雨夜”已持续 31 章" note="建议在近期章节推进主线" urgent /><Attention icon={BrainCircuit} title="7 个伏笔尚未收束" note="2 条主线 · 3 条支线 · 2 个细节" /><Attention icon={FileClock} title="第 41 章还没有版本备份" note="建议完成本章后创建备份" /></div></section>
      <section className="panel recent"><PanelTitle title="最近章节" action="全部章节" />{chapters.slice(0,5).map(c => <div key={c[0]}><b>{c[0]}</b><strong>{c[1]}</strong><span>{c[2]} 字</span><small>今天</small><ChevronRight size={15} /></div>)}</section>
      <section className="panel agent-promo"><span><WandSparkles size={22} /></span><div><label>创作助手</label><h3>让 Agent 帮你整理下一章</h3><p>基于大纲、角色和未收束伏笔生成一份可审阅计划。</p></div><Button kind="dark"><Sparkles size={15} />开始规划</Button></section>
    </div>
  </Scroll>
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: ElementType; label: string; value: string; note: string; tone: string }) {
  return <article className={'metric ' + tone}><span><Icon size={19} /></span><div><label>{label}</label><strong>{value}</strong><small>{note}</small></div></article>
}
function Attention({ icon: Icon, title, note, urgent }: { icon: ElementType; title: string; note: string; urgent?: boolean }) {
  return <div className={urgent ? 'urgent' : ''}><Icon size={17} /><p><strong>{title}</strong><small>{note}</small></p><ChevronRight size={15} /></div>
}

function WritingPage({ assistant, onAssistant }: { assistant: boolean; onAssistant: () => void }) {
  const [tab, setTab] = useState('quick')
  return <div className="writing-page">
    <aside className="chapters-pane"><div className="pane-title"><div><label>卷一 · 临川旧雨</label><strong>章节目录</strong></div><button><Plus size={16} /></button></div><SearchBox text="搜索章节或正文" />
      <div className="chapter-list">{chapters.map((c,i) => <button className={i === 3 ? 'active' : ''} key={c[0]}><GripVertical size={13} /><b>{c[0]}</b><span><strong>{c[1]}</strong><small>{c[2]} 字</small></span>{i < 4 && <Check size={12} />}</button>)}</div>
      <button className="new-chapter"><Plus size={14} />新建章节</button>
    </aside>
    <section className="editor"><div className="editor-toolbar"><button><Undo2 size={15} /></button><button><Redo2 size={15} /></button><i /><span>第 04 章 <ChevronRight size={12} /> <strong>玉佩上的裂痕</strong></span><b /><em><Check size={12} />已保存 19:42</em><button><Save size={14} />保存</button><button><Focus size={14} /></button><button className={'assist-toggle ' + (assistant ? 'active' : '')} onClick={onAssistant}><WandSparkles size={14} />辅助中心</button></div>
      <div className="paper-wrap"><article className="paper"><label>第四章</label><h1>玉佩上的裂痕</h1><div className="ornament"><i /><Feather size={14} /><i /></div>{manuscript.map((p,i) => <p key={i}>{p}{i === manuscript.length - 1 && <span className="caret" />}</p>)}</article></div>
      <footer className="editor-status"><span>本章 3,086 字</span><span>全文 124,680 字</span><b /><span>段落 18</span><span>预计阅读 7 分钟</span></footer>
    </section>
    {assistant && <aside className="assistant"><div className="assistant-title"><span><Sparkles size={14} /></span><strong>辅助中心</strong><button onClick={onAssistant}><PanelRightClose size={15} /></button></div><div className="assistant-tabs"><button className={tab === 'quick' ? 'active' : ''} onClick={() => setTab('quick')}>快捷生成</button><button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>Agent</button><button className={tab === 'ref' ? 'active' : ''} onClick={() => setTab('ref')}>参考</button></div>{tab === 'quick' ? <QuickAI /> : tab === 'agent' ? <AgentPanel /> : <ReferencePanel />}</aside>}
  </div>
}

function QuickAI() {
  return <div className="assist-body"><div className="assist-intro"><span><WandSparkles size={18} /></span><div><strong>接下来想怎么写？</strong><p>结合当前章节和作品资料生成草稿。</p></div></div><label>写作要求</label><div className="prompt"><textarea defaultValue="让马车里的人交代城北线索，但不要揭示他的真实身份。气氛保持克制、紧张。" /><footer><button><Tag size={12} />添加约束</button><span>62 / 500</span></footer></div><div className="two-fields"><Field title="生成方式" value="续写正文" /><Field title="目标长度" value="约 800 字" /></div><div className="context-box"><p><Database size={13} /><strong>本次上下文</strong><span>已自动选择</span></p><div><button>沈砚 <X size={10} /></button><button>裂纹玉佩 <X size={10} /></button><button>雨夜 <X size={10} /></button><button>+ 添加</button></div></div><button className="generate"><Sparkles size={15} />生成可审阅草稿<kbd>⌘ ↵</kbd></button><small className="safe-note"><ShieldCheck size={13} />不会自动写入正文，确认后才会应用。</small></div>
}
function AgentPanel() {
  return <div className="assist-body agent-body"><span className="agent-orb"><Bot size={27} /></span><h3>写作 Agent</h3><p>给出目标，Agent 会收集资料、生成草稿并自检。</p><label>任务目标</label><textarea className="agent-goal" defaultValue="完成本章后半段，推进玉佩伏笔，但不要揭晓幕后人物。" /><div className="plan-preview">{['收集作品上下文','生成章节草稿','目标符合度自检'].map((x,i) => <div key={x}><b>{i+1}</b><span><strong>{x}</strong><small>{i === 0 ? '近期章节、人物、伏笔' : i === 1 ? '等待作者审阅' : '检查连续性问题'}</small></span></div>)}</div><button className="generate"><Bot size={15} />运行写作 Agent</button></div>
}
function ReferencePanel() {
  return <div className="assist-body"><SearchBox text="搜索书籍、章节和资料…" />{[['书籍资料','《雨夜叙事的空间感》','雨声既是环境，也是隔断人物交流的屏障。'],['其他章节','第 01 章 · 雨夜来客','他第一次看见那辆没有灯笼的马车。']].map(r => <article className="ref-card" key={r[1]}><label>{r[0]}</label><strong>{r[1]}</strong><p>{r[2]}</p><button><Plus size={12} />加入本次参考</button></article>)}</div>
}
function Field({ title, value }: { title: string; value: string }) { return <label><span>{title}</span><select><option>{value}</option></select></label> }

function OutlinePage() {
  const rows = [['卷一 · 临川旧雨','归乡、旧案与重新出现的信物','进行中','volume'],['01 雨夜来客','沈砚回到临川，收到第一封无名信。','已完成','chapter'],['02 旧城的钟声','苏晚照现身，钟楼第一次出现异响。','已完成','chapter'],['03 无名渡口','渡口老人交出密道钥匙后遇害。','已完成','chapter'],['04 玉佩上的裂痕','神秘马车带来城北线索。','写作中','chapter'],['场景 A · 雨夜马车','陌生人递出烧毁的半封信。','已规划','scene'],['场景 B · 城北旧宅','旧宅门锁近期被人更换。','待规划','scene']]
  return <Scroll><PageHeader eyebrow="结构规划" title="大纲" desc="按卷、章和场景组织故事结构。" actions={<><Button>思维导图</Button><Button kind="primary"><Plus size={15} />添加节点</Button></>} /><div className="outline-summary"><span><strong>3</strong>卷</span><span><strong>42</strong>章节</span><span><strong>126</strong>场景</span><div><p>整体规划 <b>68%</b></p><i><em /></i></div></div><section className="outline-table"><header><span>结构与标题</span><span>情节摘要</span><span>状态</span></header>{rows.map((r,i) => <div className={r[3]} key={r[0]}><span><GripVertical size={13} /><ChevronDown size={13} /><FileText size={14} /><strong>{r[0]}</strong></span><p>{r[1]}</p><em>{r[2]}</em><button><MoreHorizontal size={15} /></button></div>)}</section></Scroll>
}

function CharactersPage() {
  const [selected,setSelected] = useState(0), person = people[selected]
  const [relationPreview,setRelationPreview] = useState(false)
  return <><div className="master-detail"><aside className="entity-pane"><PaneHead eyebrow="人物资料" title="角色" /><SearchBox text="搜索角色" /><div className="chips"><button className="active">全部 12</button><button>核心 4</button><button>其他 8</button></div>{people.map((p,i) => <button key={p[0]} className={'person-item ' + (i === selected ? 'active' : '')} onClick={() => setSelected(i)}><b style={{ background: p[2] }}>{p[0][0]}</b><span><strong>{p[0]}</strong><small>{p[1]}</small></span><ChevronRight size={14} /></button>)}</aside><section className="entity-detail"><div className="person-hero"><b style={{ background: person[2] }}>{person[0][0]}</b><div><label>核心人物 · 已登场</label><h1>{person[0]}</h1><p>{person[1]}</p></div><Button onClick={() => setRelationPreview(true)}><GitBranch size={14} />关系图预览</Button><Button>删除</Button><Button kind="primary"><PenLine size={14} />编辑资料</Button></div><div className="detail-grid"><Detail title="人物简介" wide><p className="lead">{person[3]} 他对秩序有近乎苛刻的要求，却会在关键时刻做出违背理性的选择。</p></Detail><Detail title="性格关键词"><div className="tag-list"><span>克制</span><span>敏锐</span><span>执拗</span><span>外冷内热</span></div></Detail><Detail title="首次登场"><LinkRecord icon={FileText} title="第 01 章 · 雨夜来客" note="客栈檐下归来" /></Detail><Detail title="人物关系" wide><div className="relations">{people.slice(1).map(p => <div key={p[0]}><b style={{ background:p[2] }}>{p[0][0]}</b><span><strong>{p[0]}</strong><small>立场复杂 · 关系待确认</small></span><em>复杂</em></div>)}</div></Detail><Detail title="关联伏笔"><LinkRecord icon={BrainCircuit} title="裂纹玉佩" note="主线 · 发展中" /></Detail><Detail title="能力与弱点"><p>擅长追踪、机关和账目分析；雨天旧伤会影响左手。</p></Detail></div></section></div>{relationPreview && <CharacterRelationPreview onClose={() => setRelationPreview(false)} />}</>
}

const relationPeople = [
  { name:'沈砚', role:'少阁主', color:'#334f68', x:50, y:52 },
  { name:'苏晚照', role:'情报商', color:'#9d6b62', x:72, y:22 },
  { name:'陆停云', role:'书院教习', color:'#6c7250', x:27, y:23 },
  { name:'谢无归', role:'北地刀客', color:'#6d5360', x:81, y:65 },
  { name:'沈静舟', role:'沈家旧主', color:'#77634c', x:19, y:68 },
  { name:'顾清川', role:'巡检使', color:'#526d6a', x:50, y:10 },
  { name:'阿七', role:'随从', color:'#7a817c', x:49, y:88 },
]
const relationEdges = [
  { from:[50,52], to:[72,22], label:'互相试探', tone:'complex', lx:63, ly:34 },
  { from:[50,52], to:[27,23], label:'师生', tone:'ally', lx:37, ly:35 },
  { from:[50,52], to:[81,65], label:'敌对', tone:'enemy', lx:67, ly:61 },
  { from:[50,52], to:[19,68], label:'父子', tone:'family', lx:33, ly:64 },
  { from:[50,52], to:[49,88], label:'追随', tone:'ally', lx:53, ly:73 },
  { from:[72,22], to:[50,10], label:'旧识', tone:'complex', lx:63, ly:12 },
  { from:[81,65], to:[50,10], label:'受命调查', tone:'enemy', lx:69, ly:39 },
  { from:[27,23], to:[19,68], label:'故交', tone:'family', lx:19, ly:43 },
]

function CharacterRelationPreview({ onClose }: { onClose:()=>void }) {
  return <div className="relation-modal" onMouseDown={onClose}><section className="relation-dialog" onMouseDown={event => event.stopPropagation()}>
    <header className="relation-dialog-head"><div className="relation-title-icon"><GitBranch size={20} /></div><div><label>角色资料 · 全局视图</label><h2>人物关系图预览</h2><p>自动按关系簇分组展示；没有任何关系的角色会单独成图。</p></div><div className="relation-summary"><span><b>12</b>角色</span><span><b>9</b>关系</span><span><b>5</b>关系图</span></div><button className="icon-button" aria-label="关闭关系图" onClick={onClose}><X size={18} /></button></header>
    <div className="relation-toolbar"><div className="relation-legend"><span className="family">亲缘</span><span className="ally">同盟</span><span className="complex">复杂</span><span className="enemy">敌对</span></div><div><button><ZoomOut size={14} /></button><span>100%</span><button><ZoomIn size={14} /></button><button><Focus size={14} />适应画布</button><button><Maximize2 size={14} />全屏</button></div></div>
    <div className="relation-scroll">
      <section className="relation-group main"><header><div><label>关系图 01</label><h3>临川旧案 · 核心关系网</h3></div><p><b>7</b> 位角色 · <b>8</b> 条关系</p></header><div className="relation-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="relation-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" /></marker></defs>{relationEdges.map((edge,index) => <g className={edge.tone} key={index}><line x1={edge.from[0]} y1={edge.from[1]} x2={edge.to[0]} y2={edge.to[1]} markerEnd="url(#relation-arrow)" /></g>)}</svg>
        {relationEdges.map((edge,index) => <span key={index} className={'edge-label ' + edge.tone} style={{ left:edge.lx+'%', top:edge.ly+'%' }}>{edge.label}</span>)}
        {relationPeople.map(person => <div className={'relation-node ' + (person.name === '沈砚' ? 'focus' : '')} key={person.name} style={{ left:person.x+'%', top:person.y+'%' }}><b style={{ background:person.color }}>{person.name[0]}</b><span><strong>{person.name}</strong><small>{person.role}</small></span></div>)}
      </div></section>
      <section className="separate-relations"><header><div><label>其他关系簇</label><h3>独立人物关系图</h3></div><p>互不关联的角色不会被强行放入同一张图</p></header><div className="relation-card-grid">
        <SmallRelationGraph index="02" title="药谷旧友" people={[['温故','药师','#6f8068'],['青萝','医女','#8d746c']]} relation="师徒" />
        <SmallRelationGraph index="03" title="暂无关系" people={[['渡口老人','守渡人','#747b78']]} />
        <SmallRelationGraph index="04" title="暂无关系" people={[['白鹤生','说书人','#7f6958']]} />
        <SmallRelationGraph index="05" title="暂无关系" people={[['云娘','客栈掌柜','#7d6770']]} />
      </div></section>
    </div>
    <footer className="relation-dialog-foot"><span><CloudOff size={13} />关系数据仅保存在本地作品中</span><p>最后整理：今天 18:42</p><Button onClick={onClose}>关闭预览</Button></footer>
  </section></div>
}

function SmallRelationGraph({ index,title,people,relation }: { index:string; title:string; people:string[][]; relation?:string }) {
  return <article className="small-relation"><header><span>关系图 {index}</span><strong>{title}</strong></header><div className={'small-relation-canvas ' + (relation ? 'paired' : 'single')}>{people.map((person,index) => <div className="mini-person" key={person[0]}><b style={{ background:person[2] }}>{person[0][0]}</b><span><strong>{person[0]}</strong><small>{person[1]}</small></span>{relation && index === 0 && <i><em>{relation}</em></i>}</div>)}</div></article>
}

function LocationsPage() {
  return <div className="master-detail"><aside className="entity-pane"><PaneHead eyebrow="空间资料" title="地点" /><SearchBox text="搜索地点" /><div className="tree"><Tree name="临川城" type="城市" active><Tree name="长街" type="街区"><Tree name="归雁客栈" type="建筑" /></Tree><Tree name="城北" type="区域"><Tree name="沈家旧宅" type="建筑" /></Tree><Tree name="无名渡口" type="渡口" /></Tree><Tree name="北境" type="地域"><Tree name="雪回关" type="关隘" /></Tree></div></aside><section className="entity-detail"><div className="location-hero"><span><MapPin size={28} /></span><div><label>城市 · 主要舞台</label><h1>临川城</h1><p>江南旧城，常年多雨，以书院、渡口与纵横水巷闻名。</p></div><Button kind="primary"><PenLine size={14} />编辑地点</Button></div><div className="map-banner"><i className="river-one" /><i className="river-two" /><em className="m1">归雁客栈</em><em className="m2">无名渡口</em><em className="m3">沈家旧宅</em></div><div className="detail-grid"><Detail title="地点描述" wide><p className="lead">临川依河而建，城中石桥密布。每逢梅雨，城北低洼处常被水雾覆盖，旧宅和废弃商铺在雾中只剩模糊轮廓。</p></Detail><Detail title="下级地点"><div className="number-pair"><span><b>8</b>建筑</span><span><b>3</b>区域</span></div></Detail><Detail title="首次出现"><LinkRecord icon={FileText} title="第 01 章 · 雨夜来客" note="开篇主场景" /></Detail></div></section></div>
}
function Tree({ name,type,active,children }: { name:string; type:string; active?:boolean; children?:ReactNode }) { return <div><button className={active ? 'active' : ''}><ChevronDown size={12} /><MapPin size={13} /><span><strong>{name}</strong><small>{type}</small></span></button>{children && <section>{children}</section>}</div> }

function WorldPage() {
  const cards = [['世界规则','雨契','临川旧族以雨为誓，契约成立时会在信物上留下水纹。','blue'],['势力分布','临川书院','表面是书院，实际上保管着历代雨契的副本。','sage'],['历史背景','沈家旧案','三年前沈家在一夜间覆灭，官方记载与证词彼此矛盾。','clay'],['法宝物品','裂纹玉佩','沈家传承信物，裂纹会随城中钟声出现变化。','plum'],['世界规则','无灯马车','雨夜不挂灯的马车只为履行未完成的旧约而来。','ink'],['势力分布','照影楼','经营消息与秘密的地下组织。','amber']]
  return <Scroll><PageHeader eyebrow="设定资料" title="世界观" desc="集中维护规则、势力、历史与关键物品。" actions={<Button kind="primary"><Plus size={14} />新建设定</Button>} /><div className="world-toolbar"><SearchBox text="搜索设定…" /><div className="chips"><button className="active">全部 24</button><button>规则 6</button><button>势力 5</button><button>历史 4</button><button>物品 9</button></div></div><div className="world-grid">{cards.map(c => <article key={c[1]}><span className={c[3]}><Globe2 size={18} /></span><label>{c[0]}</label><h2>{c[1]}</h2><p>{c[2]}</p><footer><GitBranch size={13} />关联 6 条资料<ChevronRight size={14} /></footer></article>)}</div></Scroll>
}

function ThreadsPage() {
  return <div className="threads-page"><div className="threads-top"><PageHeader eyebrow="情节追踪" title="伏笔看板" desc="从埋设到收束，持续跟踪每一条线索。" actions={<><Button>关系图</Button><Button kind="primary"><Plus size={14} />新建伏笔</Button></>} /><div className="warning"><AlertTriangle size={16} /><span><strong>2 条主线伏笔需要留意</strong>“三年前的雨夜”已持续 31 章。</span><button>查看建议</button></div><div className="board-tools"><SearchBox text="搜索伏笔" /><Button><Tag size={13} />全部优先级<ChevronDown size={12} /></Button><span>7 条伏笔 · 6 条未收束</span></div></div><div className="kanban">{threadGroups.map(g => <section key={g.title}><header><i className={g.tone} /><strong>{g.title}</strong><span>{g.cards.length}</span><button><Plus size={14} /></button></header>{g.cards.map(c => <article className={'thread-card ' + c[1]} key={c[0]}><label>{c[1]}</label><button><MoreHorizontal size={15} /></button><h3>{c[0]}</h3><p>{c[2]}</p><footer><span><FileText size={11} />第 1 章</span><span><Clock3 size={11} />已过 3 章</span></footer><div><b>沈</b><b>苏</b><em>+2</em></div></article>)}{g.title !== '已收束' && <button className="add-card"><Plus size={13} />添加伏笔</button>}</section>)}</div></div>
}

function MapsPage() {
  return <div className="maps-page"><aside className="entity-pane"><PaneHead eyebrow="空间可视化" title="地图" />{[['临川城全图','城市 · 8 个标记'],['城北旧区','区域 · 5 个标记'],['沈家密道','副本 · 4 个标记']].map((x,i) => <button className={'map-list-item ' + (i===0?'active':'')} key={x[0]}><span><Map size={17} /></span><div><strong>{x[0]}</strong><small>{x[1]}</small></div><ChevronRight size={13} /></button>)}</aside><section className="map-main"><div className="map-head"><div><label>城市地图</label><strong>临川城全图</strong></div><span><Check size={12} />已保存</span><Button>编辑地图信息</Button></div><div className="map-body"><div className="canvas-wrap"><div className="floating-tools"><button className="active"><MousePointer2 size={14} />选择</button><button><MapPin size={14} />标记</button><button><Move size={14} />路线</button><i /><button><ZoomOut size={14} /></button><b>100%</b><button><ZoomIn size={14} /></button></div><div className="visual-map"><i className="map-river r1" /><i className="map-river r2" /><em className="district d1">城北</em><em className="district d2">长街</em><em className="district d3">水巷</em><Marker cls="p1" label="归雁客栈" /><Marker cls="p2" label="临川书院" /><Marker cls="p3" label="无名渡口" /><Marker cls="p4 active" label="沈家旧宅" /><Marker cls="p5" label="钟楼" /></div></div><aside className="inspector"><div className="inspector-title"><span><MapPin size={17} /></span><div><label>已选择标记</label><strong>沈家旧宅</strong></div><X size={14} /></div><Field title="标记名称" value="沈家旧宅" /><Field title="类型" value="建筑" /><Field title="关联地点" value="沈家旧宅" /><label><span>描述</span><textarea value="沈家覆灭后被封存的旧宅。城北线索指向这里。" readOnly /></label><div className="inspector-actions"><Button kind="danger"><Trash2 size={13} />删除</Button><Button kind="primary"><Save size={13} />保存标记</Button></div></aside></div></section></div>
}
function Marker({ cls,label }: { cls:string; label:string }) { return <span className={'marker ' + cls}><i><MapPin size={12} fill="currentColor" /></i><strong>{label}</strong></span> }

function LibraryPage() {
  const items: [string,string,string,string,ElementType][] = [['《故事》','罗伯特·麦基','写作技法','关于场景转折与价值变化的笔记',BookMarked],['江南城镇建筑资料','本地 TXT 导入','世界观素材','水巷、石桥、沿街建筑的结构参考',FileText],['雨夜叙事的空间感','个人笔记','氛围描写','雨声、灯光与视线受阻的写法整理',Archive]]
  return <div className="library-page"><aside><div className="library-brand"><LibraryBig size={20} /><span><strong>参考资料库</strong><small>共 38 条资料</small></span></div><nav><button className="active"><LibraryBig size={15} />全部资料<i>38</i></button><button><BookMarked size={15} />书籍<i>12</i></button><button><FileText size={15} />文本摘录<i>18</i></button><button><Archive size={15} />个人笔记<i>8</i></button></nav><label>分类</label><nav><button><b className="blue" />写作技法<i>9</i></button><button><b className="sage" />世界观素材<i>14</i></button><button><b className="clay" />历史资料<i>8</i></button></nav><button className="import-card"><Upload size={17} /><span><strong>导入 TXT 资料</strong><small>单个文件不超过 2MB</small></span></button></aside><section><PageHeader eyebrow="本地知识库" title="全部资料" desc="这些内容可以作为 AI 生成时的可选参考。" actions={<Button kind="primary"><Plus size={14} />添加资料</Button>} /><div className="library-toolbar"><SearchBox text="搜索标题、作者、摘要或正文…" /><Button>最近更新<ChevronDown size={12} /></Button></div>{items.map(x => { const Icon=x[4] as ElementType; return <article className="source-row" key={x[0] as string}><span><Icon size={18} /></span><div><h3>{x[0]} <em>{x[2]}</em></h3><p>{x[3]}</p><small>{x[1]} · 更新于 2 天前</small></div><Button kind="ghost"><Plus size={13} />加入 AI 参考</Button><button><MoreHorizontal size={15} /></button></article> })}</section></div>
}

function SettingsPage() {
  return <div className="settings-page"><aside><div><label>应用偏好</label><strong>设置</strong></div><nav>{[[Settings,'通用'],[PenLine,'编辑器'],[Bot,'AI 模型'],[HardDrive,'数据与备份'],[ShieldCheck,'隐私与安全'],[CircleHelp,'关于']].map(([Icon,text],i) => { const I=Icon as ElementType; return <button className={i===0?'active':''} key={text as string}><I size={15} />{text as string}</button> })}</nav></aside><section><PageHeader title="通用设置" desc="这些设置只保存在当前 Windows 用户配置中。" /><SettingBlock title="外观" desc="选择适合当前环境的界面主题。"><div className="themes">{[['light','浅色','纸张与暖灰色调'],['dark','深色','适合夜间创作'],['system','跟随系统','自动切换主题']].map((x,i) => <button className={i===0?'active':''} key={x[0]}><span className={x[0]}><i /><i /></span><strong>{x[1]}</strong><small>{x[2]}</small>{i===0&&<Check size={13} />}</button>)}</div></SettingBlock><SettingBlock title="启动行为" desc="决定应用打开时显示的内容。"><SettingRow title="启动时打开上次作品" desc="回到离开时的章节和光标位置" on /><SettingRow title="显示每日写作目标" desc="在概览和状态栏展示今日进度" on /><SettingRow title="关闭窗口时最小化到托盘" desc="保持自动备份和 Agent 任务运行" /></SettingBlock><SettingBlock title="本地数据" desc="当前数据库和备份运行状态。"><div className="database-card"><span><Database size={20} /></span><div><strong>novel_writer.db</strong><p>C:\Users\Writer\AppData\Roaming\Mojing\data</p><small><Check size={11} />数据库健康 · 48.6 MB</small></div><Button>打开数据目录</Button></div></SettingBlock></section></div>
}

function SettingBlock({ title,desc,children }: { title:string; desc:string; children:ReactNode }) { return <div className="setting-block"><header><h2>{title}</h2><p>{desc}</p></header><section>{children}</section></div> }
function SettingRow({ title,desc,on }: { title:string; desc:string; on?:boolean }) { return <div className="setting-row"><span><strong>{title}</strong><small>{desc}</small></span><button className={'toggle ' + (on?'on':'')}><i /></button></div> }

function CommandPalette({ onClose,onPage }: { onClose:()=>void; onPage:(p:Page)=>void }) {
  const items: [ElementType,string,Page][] = [[PenLine,'继续写作 · 玉佩上的裂痕','writing'],[Plus,'新建章节','writing'],[BrainCircuit,'打开伏笔看板','threads'],[Users,'搜索角色资料','characters'],[LibraryBig,'打开参考资料库','library'],[Settings,'打开设置','settings']]
  return <div className="modal" onMouseDown={onClose}><div className="command" onMouseDown={e=>e.stopPropagation()}><header><Search size={18} /><input autoFocus placeholder="搜索页面、作品或命令…" /><kbd>Esc</kbd></header><label>建议操作</label>{items.map(([Icon,text,p]) => <button key={text} onClick={()=>onPage(p)}><span><Icon size={15} /></span><strong>{text}</strong><ChevronRight size={14} /></button>)}<footer><Command size={12} /> 命令面板 <span>↑↓ 选择 · Enter 打开</span></footer></div></div>
}

function Scroll({ children }: { children:ReactNode }) { return <div className="scroll-page">{children}</div> }
function SearchBox({ text }: { text:string }) { return <div className="search-box"><Search size={14} /><input placeholder={text} /></div> }
function PanelTitle({ title,action }: { title:string; action:string }) { return <header className="panel-title"><h2>{title}</h2><button>{action}<ChevronRight size={13} /></button></header> }
function PaneHead({ eyebrow,title }: { eyebrow:string; title:string }) { return <div className="pane-title"><div><label>{eyebrow}</label><strong>{title}</strong></div><button><Plus size={15} /></button></div> }
function Detail({ title,wide,children }: { title:string; wide?:boolean; children:ReactNode }) { return <section className={'detail ' + (wide?'wide':'')}><h2>{title}</h2>{children}</section> }
function LinkRecord({ icon:Icon,title,note }: { icon:ElementType; title:string; note:string }) { return <div className="link-record"><Icon size={15} /><span><strong>{title}</strong><small>{note}</small></span><ChevronRight size={14} /></div> }
