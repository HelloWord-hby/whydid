/**
 * Two UI languages, English and Chinese.
 *
 * - UI strings: the DICT below, looked up with t(lang, key).
 * - Config text (board and card titles): may be a string or {en, zh}; loc() picks.
 * - Labels the server sends (table columns, metric and dimension labels,
 *   captions): translated by exact match in LABELS or by the caption
 *   patterns; anything unknown is shown as sent.
 */
import { type Localized } from './types';

export type Lang = 'en' | 'zh';
export const LANG_KEY = 'whydid.lang';

export function initialLang(store: Pick<Storage, 'getItem'>, navigatorLang: string): Lang {
  const saved = store.getItem(LANG_KEY);
  if (saved === 'en' || saved === 'zh') return saved;
  return navigatorLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const DICT = {
  'app.tagline': { en: 'Observability', zh: '观测与归因' },
  'nav.boards': { en: 'Boards', zh: '看板' },
  'nav.analysis': { en: 'Analysis', zh: '分析' },
  'nav.metrics': { en: 'Metrics', zh: '指标总览' },
  'nav.theme': { en: 'Theme', zh: '主题' },
  'nav.language': { en: '中文', zh: 'English' },
  'top.window': { en: 'Last {n} days', zh: '近 {n} 天' },
  'top.agent': { en: 'Agent', zh: 'Agent' },
  'board.demo': { en: 'Demo data', zh: '演示数据' },
  'board.live.langfuse': { en: 'Live · Langfuse', zh: '实时 · Langfuse' },
  'board.live.pg': { en: 'Live · PostgreSQL', zh: '实时 · PostgreSQL' },
  'board.analyze': { en: 'Analyze board', zh: '分析看板' },
  'board.library': { en: 'Card library', zh: '卡片库' },
  'board.reset': { en: 'Reset layout', zh: '恢复默认' },
  'board.empty': { en: 'This board is empty. Add cards from the card library.', zh: '看板是空的，从卡片库添加卡片。' },
  'board.foot': {
    en: 'Last {n} full UTC days vs the {n} days before. Every number is computed on the server by deterministic code.',
    zh: '近 {n} 个完整 UTC 日 vs 之前 {n} 天。所有数字都由服务端的确定性代码计算。',
  },
  'board.analyzePrompt': {
    en: 'Review the {board} board: what moved the most in the last {n} days, and why?',
    zh: '巡检「{board}」看板：近 {n} 天变化最大的是哪些指标，原因是什么？',
  },
  'lib.title': { en: 'Card library', zh: '卡片库' },
  'lib.hint': { en: '{n} cards · drag onto the board or click Add', zh: '{n} 张卡片 · 拖到看板或点添加' },
  'lib.add': { en: 'Add', zh: '添加' },
  'lib.on': { en: 'On board', zh: '已添加' },
  'card.width': { en: 'Change width', zh: '调整宽度' },
  'card.remove': { en: 'Remove', zh: '移除' },
  'card.drag': { en: 'Drag to move', zh: '拖动排序' },
  'card.ask': { en: 'Ask Agent', zh: '问 Agent' },
  'card.about': { en: 'About: {title}', zh: '关于：{title}' },
  'card.prev': { en: 'prev {v}', zh: '上期 {v}' },
  'card.noBaseline': { en: 'no baseline', zh: '无基期' },
  'card.noRows': { en: 'No data in this window.', zh: '这个时间窗口没有数据。' },
  'card.total': { en: 'total', zh: '合计' },
  'preset.samples1': { en: 'What do these cases have in common?', zh: '这些样本有什么共同问题？' },
  'preset.samples2': { en: 'Where do these problems concentrate, by route or by release?', zh: '这些问题集中在哪个路由或版本？' },
  'preset.stat1': { en: 'Why did {title} change vs the previous {n} days?', zh: '{title}和前 {n} 天相比为什么变了？' },
  'preset.stat2': { en: 'Which segment drove the change in {title}?', zh: '{title}的变化主要是哪个分组带来的？' },
  'preset.line1': { en: 'What changed in {title} over the last {n} days, and why?', zh: '近 {n} 天{title}有什么变化，原因是什么？' },
  'preset.table1': { en: 'What stands out in {title}?', zh: '{title}里有什么值得注意的？' },
  'preset.table2': { en: 'Which item changed most vs the previous period, and why?', zh: '和上一期相比，哪一项变化最大，为什么？' },
  'agent.title': { en: 'Agent', zh: 'Agent' },
  'agent.new': { en: 'New chat', zh: '新对话' },
  'agent.close': { en: 'Close', zh: '关闭' },
  'agent.placeholder': { en: 'Ask why a number moved…', zh: '问问某个数字为什么变了…' },
  'agent.hint': {
    en: 'Ask about anything on the dashboard. Every number in an answer links to the tool call that produced it.',
    zh: '可以问看板上的任何数字。回答里的每个数字都能点开，看到算出它的那次工具调用。',
  },
  'agent.noLlm': {
    en: 'No LLM configured. Set WHYDID_LLM_API_KEY and restart, or run `npm run demo:agent` to try the scripted mock.',
    zh: '还没配置 LLM。设置 WHYDID_LLM_API_KEY 后重启；或者运行 `npm run demo:agent` 用脚本模拟体验。',
  },
  'agent.working': { en: 'Investigating…', zh: '分析中…' },
  'agent.steps': { en: '{n} tool calls', zh: '共 {n} 次工具调用' },
  'agent.stopped': { en: 'Stopped', zh: '已中断' },
  'agent.context': { en: 'context', zh: '上下文' },
  'agent.grounded': { en: '{n} numbers checked against tool results', zh: '{n} 个数字已和工具结果核对' },
  'agent.ungrounded': { en: '{n} numbers not found in tool results: {list}', zh: '{n} 个数字在工具结果里找不到：{list}' },
  'agent.tokens': { en: '{n} tokens · prompt {v}', zh: '{n} tokens · 提示词 {v}' },
  'agent.board': { en: 'Board · {title} · {n}d', zh: '看板 · {title} · {n} 天' },
  'agent.card': { en: 'Card · {title}', zh: '卡片 · {title}' },
  'agent.open': { en: 'Ask Agent', zh: '问 Agent' },
  'metrics.title': { en: 'Metrics', zh: '指标总览' },
  'metrics.sub': { en: 'Every metric in {table}', zh: '{table} 中的全部指标' },
  'metrics.decomp': { en: 'Decomposition', zh: '变化拆解' },
  'metrics.trend': { en: 'Trend', zh: '趋势' },
  'metrics.by': { en: 'by', zh: '按' },
  'metrics.segment': { en: 'Segment', zh: '分组' },
  'metrics.baseline': { en: 'Baseline', zh: '基期' },
  'metrics.current': { en: 'Current', zh: '当前' },
  'metrics.contribution': { en: 'Contribution', zh: '贡献' },
  'metrics.mix': { en: 'Mix effect', zh: '结构效应' },
  'metrics.behavior': { en: 'Behavior effect', zh: '组内效应' },
  'metrics.interaction': { en: 'Interaction', zh: '交互项' },
  'metrics.rate': { en: 'Rate', zh: '比率' },
  'metrics.weight': { en: 'Share of traffic', zh: '流量占比' },
  'metrics.unstable': {
    en: 'Total change is under 1% of baseline; shares of change are unreliable, ranked by absolute movement instead.',
    zh: '总变化不到基期的 1%，变化占比不可靠，改按绝对变动排序。',
  },
  'metrics.interactionWarn': {
    en: 'Interaction term is large; treat the mix/behavior split as approximate.',
    zh: '交互项较大，结构效应和组内效应的拆分只能作为近似。',
  },
  'metrics.back': { en: 'All metrics', zh: '全部指标' },
  'nav.context': { en: 'Context', zh: '补充资料' },
  'nav.releases': { en: 'Release notes', zh: '版本更新动态' },
  'nav.evals': { en: 'Eval set', zh: '评估集' },
  'nav.admin': { en: 'Settings', zh: '配置后台' },
  'admin.sub': { en: 'Model, data sources, semantic layer, boards', zh: '模型、数据源、语义层、看板' },
  'rel.title': { en: 'Release notes', zh: '版本更新动态' },
  'rel.sub': { en: 'Your AI product’s changelog — the agent reads it when a metric moves', zh: '你的 AI 产品迭代记录，指标变化时 agent 会查阅' },
  'rel.edit': { en: 'Edit', zh: '编辑' },
  'rel.upload': { en: 'Upload file', zh: '上传文件' },
  'rel.save': { en: 'Save', zh: '保存' },
  'rel.cancel': { en: 'Cancel', zh: '取消' },
  'rel.saving': { en: 'Saving…', zh: '保存中…' },
  'rel.saved': { en: 'Saved to {file}', zh: '已保存到 {file}' },
  'rel.demo': {
    en: 'Sample notes that match the demo data. Saving writes your own notes to {file} on the server.',
    zh: '这是和演示数据对应的示例记录。保存后会把你的记录写入服务器上的 {file}。',
  },
  'rel.file': { en: 'Stored in {file} on the server · updated {time}', zh: '存放在服务器上的 {file} · 更新于 {time}' },
  'rel.empty': { en: 'No release notes yet. Paste your changelog or upload a README / CHANGELOG file.', zh: '还没有迭代记录。粘贴更新日志，或上传 README / CHANGELOG 文件。' },
  'rel.count': { en: '{n} releases · {d} dated', zh: '{n} 条记录 · {d} 条有日期' },
  'rel.undated': { en: 'No date', zh: '无日期' },
  'rel.undatedHint': {
    en: 'Entries without a date cannot be matched to a metric change. Put the date in the heading.',
    zh: '没有日期的条目无法和指标变化对上时间，请在标题里写上日期。',
  },
  'rel.format': {
    en: 'One heading per release with a version and a date, e.g. "## v1.9 — 2026-11-04". Text under the heading is what changed.',
    zh: '每个版本一个标题，写上版本号和日期，比如 "## v1.9 — 2026-11-04"。标题下面写改了什么。',
  },
  'rel.uploadNote': { en: 'Loaded {name}. Review and save.', zh: '已载入 {name}，确认后保存。' },
  'rel.how': { en: 'How the agent uses it', zh: 'agent 怎么用这些记录' },
  'rel.how1': { en: 'When a metric moves on a particular day, it calls list_releases for that window.', zh: '指标在某天发生变化时，agent 会调用 list_releases 查这段时间的发版记录。' },
  'rel.how2': { en: 'A release on that day is a lead, not proof: it checks the data by release before blaming one.', zh: '同一天有发版只是线索，agent 会先按版本拆分数据核实，再下结论。' },
  'rel.how3': { en: 'Release text is treated as data, never as instructions, and is cited like any tool result.', zh: '记录内容按数据处理，不当指令执行；回答里和其他工具结果一样带引用。' },
  'rel.unavailable': { en: 'This server keeps no release log.', zh: '这个服务没有开启版本记录。' },
  'rel.marker': { en: 'Release {v}', zh: '发版 {v}' },
  'eval.title': { en: 'Eval set', zh: '评估集' },
  'eval.sub': { en: 'Questions with known answers, scored by code', zh: '已知答案的考题，代码评分' },
  'eval.run': { en: 'Run eval set', zh: '运行评估' },
  'eval.running': { en: 'Running {done}/{total} · {id}', zh: '运行中 {done}/{total} · {id}' },
  'eval.confirm': {
    en: 'This runs {n} cases against {model} and spends LLM tokens. Continue?',
    zh: '将用 {model} 跑 {n} 道题，会消耗 LLM token。继续吗？',
  },
  'eval.noLlm': { en: 'No LLM configured. Set WHYDID_LLM_API_KEY to run the set.', zh: '还没配置 LLM。设置 WHYDID_LLM_API_KEY 后才能运行。' },
  'eval.noRuns': { en: 'No runs yet. Click "Run eval set", or run npm run eval.', zh: '还没有运行记录。点"运行评估"，或运行 npm run eval。' },
  'eval.mock': {
    en: 'Scripted mock LLM: these numbers check the pipeline, not answer quality.',
    zh: '这次用的是脚本模拟 LLM，数字只说明流程跑通，不代表回答质量。',
  },
  'eval.passed': { en: 'Cases passed', zh: '通过' },
  'eval.driver': { en: 'Driver found', zh: '找到原因' },
  'eval.direction': { en: 'Direction wrong', zh: '方向说错' },
  'eval.exit': { en: 'Honest exit', zh: '诚实退出' },
  'eval.grounded': { en: 'Numbers traceable', zh: '数字可溯源' },
  'eval.cost': { en: 'Calls · tokens · s per case', zh: '每题调用 · token · 秒' },
  'eval.history': { en: 'Run history', zh: '运行记录' },
  'eval.cases': { en: 'Cases', zh: '考题' },
  'eval.when': { en: 'Time', zh: '时间' },
  'eval.model': { en: 'Model', zh: '模型' },
  'eval.prompt': { en: 'Prompt', zh: '提示词' },
  'eval.case': { en: 'Case', zh: '考题' },
  'eval.question': { en: 'Question', zh: '问题' },
  'eval.result': { en: 'Result', zh: '结果' },
  'eval.failed': { en: 'Failed checks', zh: '未通过的检查' },
  'eval.known': { en: 'Known answer', zh: '标准答案' },
  'eval.answer': { en: 'Agent answer', zh: 'Agent 回答' },
  'eval.expect': { en: 'Must mention', zh: '必须提到' },
  'eval.notRun': { en: 'Not in this run', zh: '本次未运行' },
  'eval.error': { en: 'Last run failed: {msg}', zh: '上次运行失败：{msg}' },
  'eval.of': { en: '{a} of {b}', zh: '{b} 题中 {a} 题' },
  'common.error': { en: 'Something went wrong: {msg}', zh: '出错了：{msg}' },
} as const;

export type DictKey = keyof typeof DICT;

export function t(lang: Lang, key: DictKey, vars: Record<string, string | number> = {}): string {
  let s: string = DICT[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function loc(value: Localized | undefined, lang: Lang): string {
  if (value == null) return '';
  if (typeof value === 'string') return lang === 'zh' ? (LABELS[value] ?? value) : value;
  return value[lang] ?? value.en ?? Object.values(value)[0] ?? '';
}

/** Exact-match translations for labels the server sends. Extend for your own configs. */
export const LABELS: Record<string, string> = {
  Time: '时间', Route: '路由', Release: '版本', Score: '评分', Value: '分值', Comment: '评语', Trace: 'Trace',
  Dimension: '维度', Scored: '评分数', Low: '低分数', 'Low rate': '低分率', Previous: '上期',
  'Avg (current)': '当前均值', 'Avg (previous)': '上期均值', Change: '变化', 'Low-score rate': '低分率',
  Step: '步骤', Users: '用户数', 'Of first step': '占首步', 'Step conversion': '步骤转化', Share: '占比',
  Traces: '调用量', Other: '其他', 'of total': '占总量', 'of first step': '占首步',
  'Opened app': '打开 App', 'Opened chat': '打开对话', 'Asked a question': '提问', 'Got an answer': '收到回答', 'Left feedback': '留下反馈',
  'Active users': '活跃用户', Sessions: '会话数', 'Questions sent': '提问数', 'Suggestions shown': '推荐问题曝光',
  'Suggestion clicks': '推荐问题点击', 'Suggestion click-through': '推荐问题点击率',
  'Entry point': '入口', Platform: '平台', 'Suggested question': '推荐问题', Event: '事件',
  'Home screen': '首页', 'Chat tab': '对话页', 'Push notification': '推送', Search: '搜索', 'Shared link': '分享链接',
  Conversations: '对话数', 'Unique users': '独立用户', 'Resolution rate': '解决率', 'Escalation rate': '转人工率',
  'Average latency': '平均延迟', 'Conversation intent': '对话意图', 'User language': '用户语言', Channel: '渠道',
  'Assistant model version': '模型版本',
  'How-to question': '使用咨询', Billing: '账单', 'Bug report': '问题反馈', 'Integration help': '集成帮助',
  'Account & access': '账号与权限', 'Refund request': '退款',
  'Model Output': '模型输出观测', 'Product Events': '数据埋点观测', Faithfulness: '忠实度', 'Thumbs-down rate': '点踩率',
  'Avg latency': '平均延迟', 'Score trend': '评分趋势', 'Low-score rate by dimension': '各维度低分率',
  'Low-score samples': '低分样本', 'Thumbs-down feedback': '点踩反馈', 'Score overview': '评分总览',
  'Low faithfulness by route': '各路由忠实度低分率', 'Low-score rate by release': '各版本低分率',
  'Low-score rate by route': '各路由低分率', 'Trace volume': '调用量趋势', 'Avg cost per trace': '单次调用成本',
  'Daily activity': '每日活跃', 'Assistant funnel': '助手漏斗', 'Entry mix': '入口分布', 'Entry points': '入口明细',
  'Suggested question clicks': '推荐问题点击', Platforms: '平台明细', 'Suggestion click-through trend': '推荐问题点击率趋势',
  'Users leaving feedback': '反馈用户数', 'Assistant funnel (bars)': '助手漏斗（条形）', 'Top suggested questions': '热门推荐问题',
  'Platform mix': '平台分布',
  'LLM calls in the window': '窗口内的 LLM 调用', 'Share of rated answers marked unhelpful by users': '被用户点踩的回答占比',
  'Average LLM-judge score': 'LLM 评审平均分', 'Daily average of every quality score': '各质量评分的每日均值',
  "Worst-scored answers, with the judge's rationale": '分数最低的回答，附评审理由',
  'Current vs previous average per quality score': '各质量评分当前与上期均值', 'All quality dimensions, per route': '各路由的全部质量维度',
  'Distinct users reaching each step': '到达每一步的去重用户数', 'Where sessions start': '会话从哪里开始',
  'How the LLM answers are scored — quality trends, low-score rates, thumbs-down.': 'LLM 回答的评分表现：质量趋势、低分率、点踩。',
  'How people use the product — active users, entry points, funnel, suggested questions.': '用户怎么使用产品：活跃用户、入口、漏斗、推荐问题。',
};

const CAPTIONS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Low = score below ([\d.]+)( · (.+) only)?$/, (m) => `低分 = 分数低于 ${m[1]}${m[3] ? ` · 仅 ${m[3]}` : ''}`],
  [/^Lowest (\d+) quality scores in the window$/, (m) => `窗口内分数最低的 ${m[1]} 条`],
  [/^(\d+) thumbs-down of (\d+) rated$/, (m) => `${m[2]} 条评价中 ${m[1]} 条点踩`],
  [/^(.+) by (.+)$/, (m) => `${LABELS[m[1]!] ?? m[1]} · 按${LABELS[m[2]!] ?? m[2]}`],
];

/** Translate a server-sent label or caption for display. */
export function tl(text: string | undefined, lang: Lang): string {
  if (!text) return '';
  if (lang === 'en') return text;
  if (LABELS[text]) return LABELS[text]!;
  for (const [re, fn] of CAPTIONS) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return text;
}
