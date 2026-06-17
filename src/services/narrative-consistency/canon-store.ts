/**
 * CanonStore —— 渲染进程侧的 Canon Store 门面
 *
 * 包装所有 db:canon-* IPC 调用，提供：
 *   - 强类型 API
 *   - 错误处理（失败时 console.warn，不阻塞主流程）
 *   - 批量读写便利方法（用于写回时一次性写入事件/状态/事实）
 *
 * 设计原则：
 *   - 只做 IPC 转发；所有持久化逻辑都在主进程的 CanonRepository
 *   - 读取失败时返回安全默认值（空数组/null），让生成流程不被打断
 */
import { ipc } from '../ipc-client'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
  CanonWriteback,
} from './types'

interface CanonIpcClient {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export class CanonStore {
  constructor(private readonly ipcClient: CanonIpcClient = ipc as unknown as CanonIpcClient) {}

  // ============================================================
  // Timeline
  // ============================================================

  async getTimeline(maxChapter: number, includeFlashback = true): Promise<TimelineEvent[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-timeline-get', maxChapter, includeFlashback) as TimelineEvent[]) || []
    } catch (err) {
      console.warn('[CanonStore] getTimeline 失败:', err)
      return []
    }
  }

  async getChapterTimeline(chapterNumber: number): Promise<TimelineEvent[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-timeline-get-chapter', chapterNumber) as TimelineEvent[]) || []
    } catch (err) {
      console.warn('[CanonStore] getChapterTimeline 失败:', err)
      return []
    }
  }

  async appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-timeline-append', event) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] appendTimelineEvent 失败:', err)
      return null
    }
  }

  async clearChapterTimeline(chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-timeline-clear-chapter', chapterNumber) } catch { /* 忽略 */ }
  }

  // ============================================================
  // Character State
  // ============================================================

  async getAllCharacterStates(): Promise<CharacterStateSnapshot[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-character-state-get-all') as CharacterStateSnapshot[]) || []
    } catch (err) {
      console.warn('[CanonStore] getAllCharacterStates 失败:', err)
      return []
    }
  }

  async getCharacterState(character: string): Promise<CharacterStateSnapshot | null> {
    try {
      return await this.ipcClient.invoke('db:canon-character-state-get', character) as CharacterStateSnapshot | null
    } catch (err) {
      console.warn('[CanonStore] getCharacterState 失败:', err)
      return null
    }
  }

  async upsertCharacterState(snapshot: CharacterStateSnapshot): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-character-state-upsert', snapshot) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] upsertCharacterState 失败:', err)
      return false
    }
  }

  // ============================================================
  // Plot Lines
  // ============================================================

  async getPlotLines(status?: PlotLine['status']): Promise<PlotLine[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-plot-list', status) as PlotLine[]) || []
    } catch (err) {
      console.warn('[CanonStore] getPlotLines 失败:', err)
      return []
    }
  }

  async getActivePlotLines(): Promise<PlotLine[]> {
    return this.getPlotLines('active')
  }

  async addPlotLine(line: Omit<PlotLine, 'id'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-plot-add', line) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] addPlotLine 失败:', err)
      return null
    }
  }

  async advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-plot-advance', id, currentState, lastAdvancedAt) } catch { /* 忽略 */ }
  }

  async resolvePlotLine(id: number, chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-plot-resolve', id, chapterNumber) } catch { /* 忽略 */ }
  }

  // ============================================================
  // Facts
  // ============================================================

  async getFacts(): Promise<Fact[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-fact-list') as Fact[]) || []
    } catch (err) {
      console.warn('[CanonStore] getFacts 失败:', err)
      return []
    }
  }

  async addFact(fact: Omit<Fact, 'id'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-fact-add', fact) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] addFact 失败:', err)
      return null
    }
  }

  async clearChapterFacts(chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-fact-clear-chapter', chapterNumber) } catch { /* 忽略 */ }
  }

  // ============================================================
  // Summaries
  // ============================================================

  async getRecentSummaries(limit = 5): Promise<ChapterSummary[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-summary-list-recent', limit) as ChapterSummary[]) || []
    } catch (err) {
      console.warn('[CanonStore] getRecentSummaries 失败:', err)
      return []
    }
  }

  async getSummary(chapterNumber: number): Promise<ChapterSummary | null> {
    try {
      return await this.ipcClient.invoke('db:canon-summary-get', chapterNumber) as ChapterSummary | null
    } catch (err) {
      console.warn('[CanonStore] getSummary 失败:', err)
      return null
    }
  }

  async upsertSummary(summary: ChapterSummary): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-summary-upsert', summary) } catch { /* 忽略 */ }
  }

  // ============================================================
  // 批量写回（章节定稿时一次性写入全部变更）
  // ============================================================

  /**
   * 执行章节写回（包含 timeline 事件、角色状态 delta、剧情线变更、事实、摘要）。
   * 设计目标：失败不阻塞定稿主流程；逐项吞掉异常。
   */
  async writeback(payload: CanonWriteback): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = []

    // 1) 摘要
    if (payload.chapterSummary) {
      try {
        await this.upsertSummary({
          chapterNumber: payload.chapterNumber,
          title: payload.chapterTitle,
          summary: payload.chapterSummary,
          createdAt: new Date().toISOString(),
        })
      } catch (e) { errors.push(`summary: ${String(e)}`) }
    }

    // 2) 清理本章已存在的旧事件/事实（确保重写时不会出现重复/旧版本）
    await this.clearChapterTimeline(payload.chapterNumber)
    await this.clearChapterFacts(payload.chapterNumber)

    // 3) 新增事件
    for (const ev of payload.newEvents || []) {
      const id = await this.appendTimelineEvent(ev)
      if (id === null) errors.push(`event#${ev.sequence}`)
    }

    // 4) 角色状态 delta
    for (const delta of payload.characterDeltas || []) {
      const now = new Date().toISOString()
      // 合并 after 到已有状态
      const prev = await this.getCharacterState(delta.character)
      const merged: CharacterStateSnapshot = {
        character: delta.character,
        location: delta.after.location ?? prev?.location ?? '',
        powerLevel: delta.after.powerLevel ?? prev?.powerLevel ?? '',
        physicalState: delta.after.physicalState ?? prev?.physicalState ?? '',
        mentalState: delta.after.mentalState ?? prev?.mentalState ?? '',
        keyItems: delta.after.keyItems ?? prev?.keyItems ?? '',
        currentGoal: delta.after.currentGoal ?? prev?.currentGoal ?? '',
        knowledge: delta.after.knowledge ?? prev?.knowledge ?? [],
        relationships: delta.after.relationships ?? prev?.relationships ?? {},
        recentEvents: delta.after.recentEvents ?? prev?.recentEvents ?? '',
        updatedAtChapter: delta.chapterNumber,
        updatedAt: now,
      }
      const ok = await this.upsertCharacterState(merged)
      if (!ok) errors.push(`char-state:${delta.character}`)
    }

    // 5) 剧情线变更
    for (const line of payload.plotLineChanges?.added || []) {
      const id = await this.addPlotLine(line)
      if (id === null) errors.push(`plot-add:${line.name}`)
    }
    for (const adv of payload.plotLineChanges?.advanced || []) {
      await this.advancePlotLine(adv.id, adv.currentState, adv.lastAdvancedAt)
    }
    for (const id of payload.plotLineChanges?.resolved || []) {
      await this.resolvePlotLine(id, payload.chapterNumber)
    }

    // 6) 新增事实
    for (const fact of payload.newFacts || []) {
      const id = await this.addFact(fact)
      if (id === null) errors.push(`fact:${fact.statement.slice(0, 20)}`)
    }

    return { ok: errors.length === 0, errors }
  }
}

/** 全局单例 */
export const canonStore = new CanonStore()
