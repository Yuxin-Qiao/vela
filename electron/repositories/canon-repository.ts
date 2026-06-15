/**
 * CanonRepository —— 叙事一致性 Canon Store
 *
 * 5 张新表：
 *   canon_timeline_events —— 结构化时间线事件（chapterNumber, sequence, ...）
 *   canon_character_state  —— 角色当前状态（每角色 1 行，upsert）
 *   canon_plot_lines       —— 长期未结剧情线
 *   canon_facts            —— 客观事实条目
 *   canon_chapter_summaries—— 章节摘要（结构化）
 *
 * 全部表在 database.ts 用 CREATE TABLE IF NOT EXISTS 创建，老库零迁移成本。
 */
import { getProjectDb } from '../database'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
} from '../../src/services/narrative-consistency/types'

interface TimelineRow {
  id: number
  chapter_number: number
  sequence: number
  characters: string
  location: string
  time_flow: string
  summary: string
  impact: string
  created_at: string
}

interface CharacterStateRow {
  character: string
  location: string
  power_level: string
  physical_state: string
  mental_state: string
  key_items: string
  current_goal: string
  knowledge_json: string
  relationships_json: string
  recent_events: string
  updated_at_chapter: number
  updated_at: string
}

interface PlotLineRow {
  id: number
  name: string
  status: string
  started_at: number
  last_advanced_at: number
  resolved_at: number | null
  characters: string
  current_state: string
  description: string
  created_at: string
}

interface FactRow {
  id: number
  category: string
  statement: string
  introduced_at: number
  characters: string
  evidence: string
  created_at: string
}

interface ChapterSummaryRow {
  chapter_number: number
  title: string
  summary: string
  created_at: string
}

function safeParse<T>(json: string, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function rowToTimeline(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    sequence: row.sequence,
    characters: safeParse<string[]>(row.characters, []),
    location: row.location,
    timeFlow: row.time_flow === 'flashback' ? 'flashback' : 'sequential',
    summary: row.summary,
    impact: row.impact,
    createdAt: row.created_at,
  }
}

function rowToCharacterState(row: CharacterStateRow): CharacterStateSnapshot {
  return {
    character: row.character,
    location: row.location,
    powerLevel: row.power_level,
    physicalState: row.physical_state,
    mentalState: row.mental_state,
    keyItems: row.key_items,
    currentGoal: row.current_goal,
    knowledge: safeParse<string[]>(row.knowledge_json, []),
    relationships: safeParse<Record<string, string>>(row.relationships_json, {}),
    recentEvents: row.recent_events,
    updatedAtChapter: row.updated_at_chapter,
    updatedAt: row.updated_at,
  }
}

function rowToPlotLine(row: PlotLineRow): PlotLine {
  return {
    id: row.id,
    name: row.name,
    status: (row.status as PlotLine['status']) || 'active',
    startedAt: row.started_at,
    lastAdvancedAt: row.last_advanced_at,
    resolvedAt: row.resolved_at ?? undefined,
    characters: safeParse<string[]>(row.characters, []),
    currentState: row.current_state,
    description: row.description,
  }
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    category: row.category as Fact['category'],
    statement: row.statement,
    introducedAt: row.introduced_at,
    characters: safeParse<string[]>(row.characters, []),
    evidence: row.evidence || undefined,
  }
}

function rowToSummary(row: ChapterSummaryRow): ChapterSummary {
  return {
    chapterNumber: row.chapter_number,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

export class CanonRepository {
  // ============================================================
  // 时间线事件
  // ============================================================

  /** 获取某章及之前的所有事件（按章号+sequence 升序） */
  static getTimelineUpTo(maxChapter: number, includeFlashback = true): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number <= ?
       ${includeFlashback ? '' : "AND time_flow = 'sequential'"}
       ORDER BY chapter_number ASC, sequence ASC`
    ).all(maxChapter) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 获取某章的所有事件 */
  static getTimelineByChapter(chapterNumber: number): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number = ?
       ORDER BY sequence ASC`
    ).all(chapterNumber) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 追加一个事件，返回新 id */
  static appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const result = db.prepare(`
      INSERT INTO canon_timeline_events
        (chapter_number, sequence, characters, location, time_flow, summary, impact)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.chapterNumber,
      event.sequence,
      JSON.stringify(event.characters || []),
      event.location || '',
      event.timeFlow || 'sequential',
      event.summary || '',
      event.impact || '',
    )
    return Number(result.lastInsertRowid)
  }

  /** 删除某章的全部事件（用于重写某章时清理旧事件） */
  static clearChapterTimeline(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_timeline_events WHERE chapter_number = ?`).run(chapterNumber)
  }

  // ============================================================
  // 角色状态
  // ============================================================

  /** 读取所有角色当前状态 */
  static getAllCharacterStates(): CharacterStateSnapshot[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_character_state ORDER BY updated_at_chapter DESC, character ASC`
    ).all() as CharacterStateRow[]
    return rows.map(rowToCharacterState)
  }

  /** 读取单个角色当前状态 */
  static getCharacterState(character: string): CharacterStateSnapshot | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_character_state WHERE character = ?`
    ).get(character) as CharacterStateRow | undefined
    return row ? rowToCharacterState(row) : null
  }

  /**
   * Upsert 角色状态（以最新为准，merge 后写入）。
   * 当 previous 不为空时，仅覆盖 after 中明确给出的字段（其余保留 old 值）。
   */
  static upsertCharacterState(snapshot: CharacterStateSnapshot): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')

    const existing = this.getCharacterState(snapshot.character)
    const merged: CharacterStateSnapshot = existing
      ? {
          ...existing,
          ...snapshot,
          knowledge: snapshot.knowledge && snapshot.knowledge.length > 0
            ? snapshot.knowledge
            : existing.knowledge,
          relationships: snapshot.relationships && Object.keys(snapshot.relationships).length > 0
            ? { ...existing.relationships, ...snapshot.relationships }
            : existing.relationships,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }
      : {
          ...snapshot,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }

    db.prepare(`
      INSERT INTO canon_character_state
        (character, location, power_level, physical_state, mental_state, key_items,
         current_goal, knowledge_json, relationships_json, recent_events,
         updated_at_chapter, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character) DO UPDATE SET
        location = excluded.location,
        power_level = excluded.power_level,
        physical_state = excluded.physical_state,
        mental_state = excluded.mental_state,
        key_items = excluded.key_items,
        current_goal = excluded.current_goal,
        knowledge_json = excluded.knowledge_json,
        relationships_json = excluded.relationships_json,
        recent_events = excluded.recent_events,
        updated_at_chapter = excluded.updated_at_chapter,
        updated_at = excluded.updated_at
    `).run(
      merged.character,
      merged.location || '',
      merged.powerLevel || '',
      merged.physicalState || '',
      merged.mentalState || '',
      merged.keyItems || '',
      merged.currentGoal || '',
      JSON.stringify(merged.knowledge || []),
      JSON.stringify(merged.relationships || {}),
      merged.recentEvents || '',
      merged.updatedAtChapter || 0,
      merged.updatedAt,
    )
  }

  // ============================================================
  // 剧情线
  // ============================================================

  static getPlotLines(filter?: { status?: PlotLine['status'] }): PlotLine[] {
    const db = getProjectDb()
    if (!db) return []
    let sql = `SELECT * FROM canon_plot_lines`
    const args: unknown[] = []
    if (filter?.status) {
      sql += ` WHERE status = ?`
      args.push(filter.status)
    }
    sql += ` ORDER BY last_advanced_at DESC, id ASC`
    const rows = db.prepare(sql).all(...args) as PlotLineRow[]
    return rows.map(rowToPlotLine)
  }

  /** 按名字查找（用于去重） */
  static findPlotLineByName(name: string): PlotLine | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_plot_lines WHERE name = ? LIMIT 1`
    ).get(name) as PlotLineRow | undefined
    return row ? rowToPlotLine(row) : null
  }

  static addPlotLine(line: Omit<PlotLine, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const existing = this.findPlotLineByName(line.name)
    if (existing) return existing.id || 0
    const r = db.prepare(`
      INSERT INTO canon_plot_lines
        (name, status, started_at, last_advanced_at, resolved_at, characters, current_state, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      line.name,
      line.status || 'active',
      line.startedAt || 0,
      line.lastAdvancedAt || line.startedAt || 0,
      line.resolvedAt ?? null,
      JSON.stringify(line.characters || []),
      line.currentState || '',
      line.description || '',
    )
    return Number(r.lastInsertRowid)
  }

  static advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET current_state = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(currentState, lastAdvancedAt, id)
  }

  static resolvePlotLine(id: number, chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET status = 'resolved', resolved_at = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(chapterNumber, chapterNumber, id)
  }

  // ============================================================
  // 事实
  // ============================================================

  static getFacts(): Fact[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_facts ORDER BY introduced_at ASC, id ASC`
    ).all() as FactRow[]
    return rows.map(rowToFact)
  }

  static addFact(fact: Omit<Fact, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    // 去重：相同 statement 不重复插入
    const dup = db.prepare(
      `SELECT id FROM canon_facts WHERE statement = ? LIMIT 1`
    ).get(fact.statement) as { id: number } | undefined
    if (dup) return dup.id
    const r = db.prepare(`
      INSERT INTO canon_facts (category, statement, introduced_at, characters, evidence)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      fact.category,
      fact.statement,
      fact.introducedAt || 0,
      JSON.stringify(fact.characters || []),
      fact.evidence || '',
    )
    return Number(r.lastInsertRowid)
  }

  /** 删除某章引入的全部事实（用于重写） */
  static clearChapterFacts(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_facts WHERE introduced_at = ?`).run(chapterNumber)
  }

  // ============================================================
  // 章节摘要
  // ============================================================

  static getRecentSummaries(limit = 5): ChapterSummary[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_chapter_summaries
       ORDER BY chapter_number DESC LIMIT ?`
    ).all(limit) as ChapterSummaryRow[]
    return rows.map(rowToSummary).reverse()
  }

  static getSummary(chapterNumber: number): ChapterSummary | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_chapter_summaries WHERE chapter_number = ?`
    ).get(chapterNumber) as ChapterSummaryRow | undefined
    return row ? rowToSummary(row) : null
  }

  static upsertSummary(summary: ChapterSummary): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    db.prepare(`
      INSERT INTO canon_chapter_summaries (chapter_number, title, summary, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        created_at = excluded.created_at
    `).run(
      summary.chapterNumber,
      summary.title || '',
      summary.summary || '',
      summary.createdAt || new Date().toISOString(),
    )
  }
}
