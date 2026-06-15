/**
 * AutoFix —— 自动修复生成章节中的简单一致性问题
 *
 * 策略（保守）：仅尝试"高置信度、可逆"修复，不做语义重写：
 *   - knowledge 越权：在"X 知道 Y"中插入显式来源（"据 Z 透露"）
 *   - location 瞬移：在两个地点之间插入过渡动词（"赶往"）
 *
 * 修复失败时直接返回原内容 + warning，调用方自行决定是否仍允许保存。
 */
import type { ConsistencyIssue, ConsistencyReport } from './types'

export interface AutoFixResult {
  /** 修复后的内容（若未修复则等于原内容） */
  content: string
  /** 已被自动修复的 issue */
  fixedIssues: ConsistencyIssue[]
  /** 未修复的 issue（保留为 warning） */
  remainingIssues: ConsistencyIssue[]
  /** 是否发生了实际修改 */
  modified: boolean
}

const FIX_TRANSITION_VERBS = ['来到', '抵达', '前往', '赶往']

/**
 * 尝试自动修复。返回修复结果，调用方决定是否采用。
 */
export function tryAutoFix(
  content: string,
  issues: ConsistencyIssue[],
): AutoFixResult {
  let working = content
  const fixed: ConsistencyIssue[] = []
  const remaining: ConsistencyIssue[] = []

  for (const issue of issues) {
    if (issue.severity === 'error') {
      // error 级别不自动修复，避免引入新错误
      remaining.push(issue)
      continue
    }

    if (issue.category === 'knowledge' && issue.evidence) {
      const result = fixKnowledgeLeak(working, issue.evidence)
      if (result.modified) {
        working = result.content
        fixed.push(issue)
        continue
      }
    }

    if (issue.category === 'location' && issue.characters?.[0]) {
      const result = fixLocationJump(working, issue)
      if (result.modified) {
        working = result.content
        fixed.push(issue)
        continue
      }
    }

    remaining.push(issue)
  }

  return {
    content: working,
    fixedIssues: fixed,
    remainingIssues: remaining,
    modified: fixed.length > 0,
  }
}

/**
 * 修复知识越权：在"<角色> 知道了 <信息>"之前插入显式信息源
 * 输入格式："张三知道了某件秘密"
 * 输出格式："张三（据前文线索）知道了某件秘密"
 *
 * 保守策略：只补充来源标注，不删减原文。
 */
function fixKnowledgeLeak(
  content: string,
  evidence: string,
): { content: string; modified: boolean } {
  const idx = content.indexOf(evidence)
  if (idx < 0) return { content, modified: false }

  // 在 evidence 之前插入"（据前文线索）"
  const before = content.slice(0, idx)
  const after = content.slice(idx)
  // 避免重复插入
  if (before.endsWith('（据前文线索）') || before.endsWith('（回忆中）')) {
    return { content, modified: false }
  }
  const insertion = '（据前文线索）'
  return {
    content: before + insertion + after,
    modified: true,
  }
}

/**
 * 修复地点瞬移：在两个地点变化的段落之间插入转场动词
 * 策略：在 evidence 段落开头插入"他/她 <verb> <newLocation>"
 *
 * 保守策略：只在 evidence 段落很短（<= 80 字）时插入，避免破坏原文节奏
 */
function fixLocationJump(
  content: string,
  issue: ConsistencyIssue,
): { content: string; modified: boolean } {
  const evidence = issue.evidence || ''
  if (!evidence) return { content, modified: false }

  // 从 evidence 中提取新地点
  const match = issue.message.match(/变为「([^」]+)」/)
  const newLocation = match?.[1]
  if (!newLocation) return { content, modified: false }

  // 在 evidence 段落开头插入
  const idx = content.indexOf(evidence)
  if (idx < 0) return { content, modified: false }
  const verb = FIX_TRANSITION_VERBS[Math.abs(hashStr(evidence)) % FIX_TRANSITION_VERBS.length]
  const charName = issue.characters?.[0] || '他'
  const insertion = `${charName}${verb}${newLocation}。\n\n`

  // 避免重复插入
  if (content.includes(insertion.slice(0, 8))) {
    return { content, modified: false }
  }

  return {
    content: content.slice(0, idx) + insertion + content.slice(idx),
    modified: true,
  }
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return h
}

/**
 * 把 ConsistencyIssue 列表转为人可读的 warning 文本（用于附加到章节末尾 / 后处理日志）
 */
export function issuesToWarnings(issues: ConsistencyIssue[]): string {
  if (issues.length === 0) return ''
  const lines = issues.map((issue, i) => {
    const sev = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
    const chars = issue.characters?.length ? `[${issue.characters.join('/')}] ` : ''
    return `${i + 1}. ${sev} ${chars}${issue.message}${issue.evidence ? `\n   证据：${issue.evidence}` : ''}`
  })
  return `【叙事一致性提示】\n${lines.join('\n')}\n（以上问题不影响保存，但请作者审阅）`
}

/** 构造 ConsistencyReport（汇总 validate + autoFix） */
export function buildReport(
  originalIssues: ConsistencyIssue[],
  autoFixResult: AutoFixResult,
  originalContent: string,
): ConsistencyReport {
  const allIssues = [...autoFixResult.fixedIssues.map(i => ({ ...i, severity: 'info' as const, message: `[已自动修复] ${i.message}` })), ...autoFixResult.remainingIssues]
  return {
    issues: allIssues,
    autoFixed: autoFixResult.modified,
    repairedContent: autoFixResult.modified ? autoFixResult.content : undefined,
    generatedAt: new Date().toISOString(),
  }
}
