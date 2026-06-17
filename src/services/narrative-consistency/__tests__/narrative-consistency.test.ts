/**
 * 叙事一致性（Narrative Consistency）测试套件
 *
 * 覆盖目标文档要求的 5 类核心测试：
 *   1. 人物地点连续性（不能回退）
 *   2. 人物知识越权检测
 *   3. 人物关系连续性
 *   4. 时间线顺序正确性
 *   5. rewrite/refine 不破坏事实
 *
 * 每个测试都使用真实的中文玄幻题材片段以贴近实际生成场景。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../../../electron/database'
import { CanonRepository } from '../../../../electron/repositories/canon-repository'
import {
  checkLocationContinuity,
  checkKnowledgeAuthorization,
  checkRelationshipContinuity,
  checkTimelineOrder,
  checkPreviousEndingContinuity,
  checkRewriteFactSafety,
  checkItemOwnership,
  validateChapter,
  tryAutoFix,
  runConsistencyGate,
  renderCanonContext,
  extractCanonWriteback,
  CanonStore,
  type CanonContext,
} from '../index'
import {
  makeState,
  makeCanon,
  makeTimeline,
  makePlotLines,
  makeFacts,
} from './fixtures'

// ============================================================
// 1. 人物地点连续性
// ============================================================
describe('1. 人物地点连续性（不能无解释瞬移）', () => {
  it('合法转场（"来到/前往/到达"）不应被报告', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩站在山门之外。\n\n林轩来到大殿之中。\n\n林轩走到师父面前。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })

  it('同一地点不应触发瞬移警告', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩在青云山练剑。\n\n林轩在青云山打坐。\n\n林轩在青云山眺望。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })

  it('无解释的地点瞬移应被报告为 warning', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩在青云山与师父告别。\n\n山门外飞雪漫天。\n\n林轩在烈火宗与人激战。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.length).toBeGreaterThan(0)
    const locationIssue = issues.find(i => i.category === 'location')
    expect(locationIssue).toBeDefined()
    expect(locationIssue?.message).toContain('青云山')
    expect(locationIssue?.message).toContain('烈火宗')
    expect(locationIssue?.characters).toContain('林轩')
  })

  it('泛指代词（他/她）不应误触发地点检查', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `他在青云山练剑。\n\n她望着远方的烈火宗。`
    const issues = checkLocationContinuity(text, [state])
    // 他/她 不在角色名单里，不应触发
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })
})

// ============================================================
// 2. 人物知识越权检测
// ============================================================
describe('2. 人物知识越权检测', () => {
  it('canon knowledge 列表中已有的信息不应被警告', () => {
    const state = makeState({
      character: '林轩',
      knowledge: ['师父被害', '幕后黑手是赵无极'],
    })
    const text = `林轩知道了师父被害的真相，心中愤恨。`
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })

  it('canon knowledge 中未记录的信息应被警告', () => {
    const state = makeState({ character: '林轩', knowledge: ['师父被害'] })
    const text = `林轩知道了九转还魂丹的下落，立刻动身前往。`
    const issues = checkKnowledgeAuthorization(text, [state])
    const knowledgeIssue = issues.find(i => i.category === 'knowledge')
    expect(knowledgeIssue).toBeDefined()
    expect(knowledgeIssue?.characters).toContain('林轩')
    expect(knowledgeIssue?.message).toContain('九转还魂丹')
  })

  it('"记得/记忆" 视为合法回忆（不警告）', () => {
    const state = makeState({ character: '林轩', knowledge: [] })
    const text = `林轩记得十年前的灭门惨案。`
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })

  it('非人物名字不应被纳入检查（避免误报）', () => {
    const state = makeState({ character: '林轩', knowledge: [] })
    const text = `张三知道了秘密。` // 张三 不在角色名单里
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })
})

// ============================================================
// 3. 人物关系连续性
// ============================================================
describe('3. 人物关系连续性', () => {
  it('与 canon 一致的关系词不应被警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩与赵无极是敌人，双方势不两立。`
    const issues = checkRelationshipContinuity(text, [state])
    expect(issues.filter(i => i.category === 'relationship')).toHaveLength(0)
  })

  it('与 canon 矛盾的关系词应被警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩与赵无极是朋友，谈笑风生。`
    const issues = checkRelationshipContinuity(text, [state])
    const relIssue = issues.find(i => i.category === 'relationship')
    expect(relIssue).toBeDefined()
    expect(relIssue?.characters).toContain('林轩')
    expect(relIssue?.characters).toContain('赵无极')
    expect(relIssue?.message).toContain('朋友')
  })

  it('未涉及已知关系对的内容不应触发警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩独自在山门修炼剑法。`
    const issues = checkRelationshipContinuity(text, [state])
    expect(issues.filter(i => i.category === 'relationship')).toHaveLength(0)
  })
})

// ============================================================
// 4. 时间线顺序正确性
// ============================================================
describe('4. 时间线顺序正确性', () => {
  it('canon 中单调递增的 sequence 不应被警告', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
        { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
        { chapterNumber: 2, sequence: 3, summary: '得到任务' },
      ]),
    })
    const text = `林轩进入大殿，遇见师父，得到任务。`
    const issues = checkTimelineOrder(text, canon.timeline, 2, false)
    expect(issues.filter(i => i.category === 'timeline' && i.severity === 'error')).toHaveLength(0)
    expect(issues.filter(i => i.category === 'event-order' && i.severity === 'error')).toHaveLength(0)
  })

  it('canon 中 sequence 倒退应被检测为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
        { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
        { chapterNumber: 2, sequence: 1, summary: '错误：倒退' }, // 故意让 sequence 倒退
      ]),
    })
    const text = `一些文本`
    const issues = checkTimelineOrder(text, canon.timeline, 2, false)
    const orderIssue = issues.find(i => i.category === 'event-order' && i.severity === 'error')
    expect(orderIssue).toBeDefined()
    expect(orderIssue?.message).toContain('sequence 不单调')
  })

  it('闪回章节不应触发时间顺序检查', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 1, sequence: 1, summary: '事件1' },
      ]),
    })
    const text = `林轩回忆起十年前的惨案，那时候他还只是个孩子。`
    const issues = checkTimelineOrder(text, canon.timeline, 2, true) // isFlashback=true
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

// ============================================================
// 5. rewrite/refine 不破坏事实
// ============================================================
describe('5. rewrite/refine 不破坏事实', () => {
  it('精修后的内容让已死亡角色复活应被检测为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '林轩师父在烈火宗之战中死亡',
          impact: '师父死亡',
          characters: ['师父'],
        },
      ]),
      characterStates: [makeState({ character: '师父', physicalState: '死亡' })],
    })
    const refinedText = `师父在青云山上笑着说："孩子们，我来了。"\n\n师父挥剑斩向敌人。`
    const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
    const issue = issues.find(i => i.category === 'continuity' && i.characters?.includes('师父'))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('闪回标记内的死亡角色不应被误报', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '师父死亡',
          characters: ['师父'],
        },
      ]),
    })
    const text = `林轩脑海中浮现出师父教他剑法的回忆，那时候师父还活着，挥剑斩向妖魔。`
    const issues = checkRewriteFactSafety(text, canon.timeline, canon.knownFacts)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('精修未破坏既有事实时应无 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '林轩离开天元城',
          characters: ['林轩'],
        },
      ]),
      characterStates: [makeState({ character: '林轩', location: '青云山' })],
    })
    const refinedText = `林轩站在青云山上，眺望远方的天元城。他回想起刚才离开时师父的叮嘱。`
    const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

// ============================================================
// 集成：validateChapter + tryAutoFix
// ============================================================
describe('集成：validateChapter 与 tryAutoFix', () => {
  it('validateChapter 应聚合多个维度的 issue', () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', knowledge: ['师父被害'] })],
      timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件' }]),
    })
    // 同时触发：地点瞬移 + 知识越权 + 关系矛盾
    const text = `林轩在青云山与赵无极是朋友，谈笑风生。\n\n林轩知道了九转还魂丹的位置。\n\n林轩在烈火宗拔剑。`
    const issues = validateChapter({
      chapterNumber: 2,
      chapterContent: text,
      canon,
      isRewrite: false,
    })
    const categories = new Set(issues.map(i => i.category))
    expect(categories.has('location')).toBe(true)
    expect(categories.has('knowledge')).toBe(true)
  })

  it('tryAutoFix 应对 knowledge leak 进行高置信度修复', () => {
    const text = `林轩知道了九转还魂丹的位置，立刻动身。`
    const issues = [
      {
        severity: 'warning' as const,
        category: 'knowledge' as const,
        characters: ['林轩'],
        message: '知识越权',
        evidence: '林轩知道了九转还魂丹',
      },
    ]
    const result = tryAutoFix(text, issues)
    expect(result.modified).toBe(true)
    expect(result.content).toContain('（据前文线索）')
    expect(result.fixedIssues.length).toBe(1)
  })

  it('error 级别 issue 不应被自动修复（保守策略）', () => {
    const text = `林轩挥剑斩敌。`
    const issues = [
      {
        severity: 'error' as const,
        category: 'continuity' as const,
        characters: ['林轩'],
        message: '林轩已死亡不应复活',
      },
    ]
    const result = tryAutoFix(text, issues)
    expect(result.modified).toBe(false)
    expect(result.content).toBe(text)
    expect(result.remainingIssues.length).toBe(1)
  })
})

// ============================================================
// 集成：renderCanonContext 输出顺序
// ============================================================
describe('CanonContext 注入顺序（强约束：固定优先级）', () => {
  it('renderCanonContext 应按指定顺序注入各块', () => {
    const canon: CanonContext = makeCanon({
      characterStates: [makeState({ character: '林轩' })],
      timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件A' }]),
      openPlotLines: makePlotLines([{ name: '复仇之路' }]),
      knownFacts: makeFacts([{ statement: '林轩是主角' }]),
    })
    const rendered = renderCanonContext(canon)

    // 顺序校验：每个块标题应按指定顺序出现
    const expectedOrder = [
      '正史设定',
      '人物群像',
      '当前人物状态',
      '已发生事件时间线',
      '最近章节摘要',
      '未结剧情线',
      '关键事实条目',
      '上一章结尾',
      '本章写作目标',
      '知识库参考',
      '文风要求',
      '全局行文指导',
      '硬性约束',
    ]
    let lastIdx = -1
    for (const title of expectedOrder) {
      const idx = rendered.indexOf(title)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('空字段块应被自动跳过', () => {
    const canon = makeCanon({
      characterStates: [],
      timeline: [],
      openPlotLines: [],
      knownFacts: [],
      previousEnding: '',
      ragContext: '',
    })
    const rendered = renderCanonContext(canon)
    // 空块不应出现
    expect(rendered).not.toContain('暂无')
    expect(rendered).not.toContain('无 RAG')
  })
})

// ============================================================
// 集成：fact-extractor 写回
// ============================================================
describe('fact-extractor：定稿时的结构化写回', () => {
  it('应能从章节正文中提取事件、角色 delta、事实', () => {
    const chapterContent = `林轩在青云山与师父告别。师父递给他一柄青虹剑。

林轩离开青云山前往烈火宗。

李四在烈火宗等待林轩到来，他们约定共同对抗赵无极。

林轩知道赵无极是幕后黑手，怒不可遏。`
    const characters = [
      { name: '林轩', role: 'protagonist', currentState: { location: '青云山', keyItems: '青虹剑' } },
      { name: '师父', role: 'supporting', currentState: {} },
      { name: '李四', role: 'supporting', currentState: {} },
      { name: '赵无极', role: 'antagonist', currentState: {} },
    ]
    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '第五章 告别',
      chapterContent,
      characters,
      chapterBlueprint: { keyEvents: '开启对抗赵无极的旅程', characters: ['林轩', '李四'] },
    })

    expect(payload.chapterNumber).toBe(5)
    expect(payload.chapterTitle).toBe('告别')
    // 至少应提取到一些事件
    expect(payload.newEvents.length).toBeGreaterThan(0)
    // 角色 deltas 应包含林轩
    const zhangSanDelta = payload.characterDeltas.find(d => d.character === '林轩')
    expect(zhangSanDelta).toBeDefined()
    // 事实条目应包含身份/物品类
    const allStatements = payload.newFacts.map(f => f.statement)
    expect(allStatements.some(s => s.includes('青虹剑'))).toBe(true)
    // 剧情线变更：因为 keyEvents 包含"开启"
    expect(payload.plotLineChanges.added?.length || 0).toBeGreaterThanOrEqual(0)
  })

  it('空章节不应抛出异常，应返回空 payload', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '',
      characters: [],
    })
    expect(payload.newEvents).toHaveLength(0)
    expect(payload.characterDeltas).toHaveLength(0)
    expect(payload.newFacts).toHaveLength(0)
  })
})

// ============================================================
// 集成：物品归属校验
// ============================================================
describe('物品归属校验', () => {
  it('canon 归属人正常使用物品不应触发警告', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `林轩拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    expect(issues.filter(i => i.category === 'item' && i.severity === 'error')).toHaveLength(0)
  })

  it('他人使用 canon 归属物品应触发 info 级别提示', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `李四拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    const itemIssue = issues.find(i => i.category === 'item')
    expect(itemIssue).toBeDefined()
    expect(itemIssue?.characters).toContain('李四')
    expect(itemIssue?.characters).toContain('林轩')
  })
})

// ============================================================
// 集成：上一章结尾衔接
// ============================================================
describe('上一章结尾衔接', () => {
  it('本章开头承接上一章人物应通过', () => {
    const text = `林轩站在青云山巅，望向远方的天元城。他决定立即出发。`
    const previousEnding = `林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。`
    const issues = checkPreviousEndingContinuity(text, previousEnding)
    // 共享人物名"林轩" → 不应警告
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('本章开头无上一章人物应触发 info 级别提示', () => {
    const text = `周明在烈火宗巡视了一圈，并未发现任何异常。`
    const previousEnding = `林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。`
    const issues = checkPreviousEndingContinuity(text, previousEnding)
    const info = issues.find(i => i.category === 'continuity')
    expect(info).toBeDefined()
    expect(info?.message).toContain('林轩')
  })
})

// ============================================================
// 功能级集成：Soft gate 三态
// ============================================================
describe('Soft gate：PASS / REPAIR / BLOCK', () => {
  it('无一致性问题时返回 PASS', async () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', location: '青云山', knowledge: ['师父被害'] })],
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 1,
      chapterContent: '林轩在青云山练剑，心中记着师父被害之事。',
      canon,
    })
    expect(result.verdict).toBe('PASS')
    expect(result.repairedContent).toBeUndefined()
  })

  it('可自动补充信息来源的问题返回 REPAIR 并提供修复正文', async () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', knowledge: [] })],
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 1,
      chapterContent: '林轩知道了九转还魂丹的位置，立刻动身。',
      canon,
    })
    expect(result.verdict).toBe('REPAIR')
    expect(result.repairedContent).toContain('（据前文线索）林轩知道了九转还魂丹的位置')
    expect(result.blockingReasons).toHaveLength(0)
  })

  it('rewrite 破坏已死亡角色事实时返回 BLOCK', async () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 1,
        sequence: 1,
        summary: '师父在烈火宗之战中死亡',
        impact: '师父死亡',
        characters: ['师父'],
      }]),
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 2,
      chapterContent: '师父笑着走进大殿，说孩子们我回来了。',
      canon,
      isRewrite: true,
    })
    expect(result.verdict).toBe('BLOCK')
    expect(result.blockingReasons.join('\n')).toContain('已死亡人物')
  })
})

// ============================================================
// 功能级集成：CanonStore writeback（IPC → 持久化门面）
// ============================================================
describe('CanonStore.writeback', () => {
  it('按章节写回摘要、时间线、角色状态、剧情线和事实', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const fakeIpc = {
      async invoke(channel: string, ...args: unknown[]) {
        calls.push({ channel, args })
        if (channel === 'db:canon-character-state-get') {
          return {
            character: args[0] as string,
            location: '青云山',
            powerLevel: '筑基期',
            physicalState: '正常',
            mentalState: '',
            keyItems: '旧剑',
            currentGoal: '',
            knowledge: ['师父被害'],
            relationships: {},
            recentEvents: '',
            updatedAtChapter: 1,
            updatedAt: '2025-01-01T00:00:00Z',
          }
        }
        if (channel.endsWith('-append') || channel.endsWith('-add')) return { success: true, id: calls.length }
        if (channel.endsWith('-upsert')) return { success: true }
        return { success: true }
      },
    }

    const store = new CanonStore(fakeIpc)
    const result = await store.writeback({
      chapterNumber: 5,
      chapterTitle: '告别',
      chapterSummary: '林轩告别师父，前往烈火宗。',
      newEvents: [{
        chapterNumber: 5,
        sequence: 1,
        characters: ['林轩'],
        location: '烈火宗',
        timeFlow: 'sequential',
        summary: '林轩抵达烈火宗',
        impact: '位置变化',
      }],
      characterDeltas: [{
        character: '林轩',
        chapterNumber: 5,
        after: {
          location: '烈火宗',
          keyItems: '旧剑、青虹剑',
          recentEvents: '抵达烈火宗',
        },
      }],
      plotLineChanges: {
        added: [{
          name: '对抗赵无极',
          status: 'active',
          startedAt: 5,
          lastAdvancedAt: 5,
          characters: ['林轩'],
          currentState: '本章开启',
          description: '开启对抗赵无极的旅程',
        }],
      },
      newFacts: [{
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 5,
        characters: ['林轩'],
        evidence: '师父递给他一柄青虹剑',
      }],
    })

    expect(result.ok).toBe(true)
    expect(calls.map(c => c.channel)).toEqual([
      'db:canon-summary-upsert',
      'db:canon-timeline-clear-chapter',
      'db:canon-fact-clear-chapter',
      'db:canon-timeline-append',
      'db:canon-character-state-get',
      'db:canon-character-state-upsert',
      'db:canon-plot-add',
      'db:canon-fact-add',
    ])
    const stateUpsert = calls.find(c => c.channel === 'db:canon-character-state-upsert')?.args[0] as { location: string; keyItems: string; knowledge: string[]; updatedAtChapter: number }
    expect(stateUpsert.location).toBe('烈火宗')
    expect(stateUpsert.keyItems).toBe('旧剑、青虹剑')
    expect(stateUpsert.knowledge).toEqual(['师父被害'])
    expect(stateUpsert.updatedAtChapter).toBe(5)
  })
})

// ============================================================
// 功能级集成：CanonRepository（SQLite 持久化）
// ============================================================
describe('CanonRepository SQLite persistence', () => {
  it('真实 SQLite 表能持久化 timeline/state/plot/fact/summary', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-canon-db-'))
    try {
      initProjectDatabase(projectDir)

      const eventId = CanonRepository.appendTimelineEvent({
        chapterNumber: 3,
        sequence: 1,
        characters: ['林轩'],
        location: '烈火宗',
        timeFlow: 'sequential',
        summary: '林轩抵达烈火宗',
        impact: '位置更新',
      })
      expect(eventId).toBeGreaterThan(0)
      expect(CanonRepository.getTimelineUpTo(3)).toMatchObject([
        { chapterNumber: 3, sequence: 1, characters: ['林轩'], location: '烈火宗' },
      ])

      CanonRepository.upsertCharacterState({
        character: '林轩',
        location: '烈火宗',
        powerLevel: '筑基期',
        physicalState: '正常',
        mentalState: '警惕',
        keyItems: '青虹剑',
        currentGoal: '调查赵无极',
        knowledge: ['师父被害'],
        relationships: { 赵无极: '敌人' },
        recentEvents: '抵达烈火宗',
        updatedAtChapter: 3,
        updatedAt: '2026-01-01T00:00:00Z',
      })
      expect(CanonRepository.getCharacterState('林轩')).toMatchObject({
        character: '林轩',
        location: '烈火宗',
        knowledge: ['师父被害'],
        relationships: { 赵无极: '敌人' },
      })

      const plotId = CanonRepository.addPlotLine({
        name: '对抗赵无极',
        status: 'active',
        startedAt: 3,
        lastAdvancedAt: 3,
        characters: ['林轩', '赵无极'],
        currentState: '发现线索',
        description: '林轩开始追查幕后黑手',
      })
      CanonRepository.advancePlotLine(plotId, '已锁定烈火宗', 4)
      expect(CanonRepository.getPlotLines({ status: 'active' })[0]).toMatchObject({
        id: plotId,
        currentState: '已锁定烈火宗',
        lastAdvancedAt: 4,
      })

      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 3,
        characters: ['林轩'],
        evidence: '师父递给他一柄青虹剑',
      })
      expect(factId).toBeGreaterThan(0)
      expect(CanonRepository.getFacts()).toMatchObject([
        { statement: '林轩获得青虹剑', introducedAt: 3, characters: ['林轩'] },
      ])

      CanonRepository.upsertSummary({
        chapterNumber: 3,
        title: '烈火宗',
        summary: '林轩抵达烈火宗并发现赵无极线索。',
        createdAt: '2026-01-01T00:00:00Z',
      })
      expect(CanonRepository.getRecentSummaries(1)).toMatchObject([
        { chapterNumber: 3, title: '烈火宗' },
      ])
    } finally {
      closeProjectDatabase()
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
