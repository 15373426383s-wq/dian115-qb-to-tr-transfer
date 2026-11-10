import { parseSources, parsePathMap, mapPath } from './lib/sources.js'
import { login, torrentList, exportTorrent, removeTorrent } from './lib/qb.js'
import { whichExist, add, verify, start, call, waitVerified, canSeeDir } from './lib/tr.js'

const LEDGER_KEY = 'ledger'
const BACKUP_PREFIX = 'torrent:'
const BACKUP_MAX = 50

// 状态机：plan → exported → added → verified → seeding → cleaned
// 任一步失败都停在原地：源种子绝不删除，能回滚就回滚。
const STAGE = { PLAN: 'plan', EXPORTED: 'exported', ADDED: 'added', VERIFIED: 'verified', SEEDING: 'seeding', CLEANED: 'cleaned' }

async function loadLedger(ctx) { return (await ctx.storage.get(LEDGER_KEY)) || {} }

async function saveLedger(ctx, ledger) {
  const keys = Object.keys(ledger)
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => String(ledger[a].at || '').localeCompare(String(ledger[b].at || '')))
    for (const k of sorted.slice(0, keys.length - 500)) delete ledger[k]
  }
  await ctx.storage.set(LEDGER_KEY, ledger)
}

// 种子文件留底：qB 删了、TR 又丢了任务时，还能凭 hash 加回来
async function backupTorrent(ctx, hash, b64) {
  const index = (await ctx.storage.get('backup_index')) || []
  await ctx.storage.set(BACKUP_PREFIX + hash, b64)
  if (!index.includes(hash)) index.push(hash)
  while (index.length > BACKUP_MAX) {
    const drop = index.shift()
    await ctx.storage.set(BACKUP_PREFIX + drop, null)
  }
  await ctx.storage.set('backup_index', index)
}

function dirOk(tr, expectDir) {
  const actual = String(tr && tr.downloadDir || '').replace(/\/+$/, '')
  const want = String(expectDir || '').replace(/\/+$/, '')
  if (!want) return true
  return actual === want || actual.startsWith(want + '/') || want.startsWith(actual + '/')
}

async function rollback(ctx, settings, hash) {
  try { await call(ctx, settings, 'torrent-remove', { ids: [hash], 'delete-local-data': false }) }
  catch (error) { await ctx.task.log(`回滚失败（TR 任务可能仍在）：${(error && error.message) || error}`) }
}

// 清 0 模式：把“TR 里已有且校验完成（percentDone>=1）”的种子，从 qB 移除任务（不删数据）。
// 用于把之前迁移时保留的源任务补清掉，以及日常“转移即清源”。
export async function cleanupQb(ctx) {
  const settings = await ctx.settings.get()
  const sources = parseSources(settings)
  if (!sources.length) throw new Error('没有可用的 qBittorrent 源')
  let removed = 0, kept = 0, notInTr = 0
  const items = []
  await ctx.task.update({ stage: 'cleanup', message: '扫描 qB 已完成种子', total: sources.length, done: 0 })
  for (const source of sources) {
    await login(ctx, source, settings)
    const list = await torrentList(ctx, source, settings, { filter: 'all' })
    const done = list.filter(t => t.progress >= 1)
    if (!done.length) { await ctx.task.log(`${source.name}：没有已完成的种子`); continue }
    const exist = await whichExist(ctx, settings, done.map(t => t.hash))
    for (const t of done) {
      const tr = exist[t.hash]
      if (tr && Number(tr.percentDone) >= 1) {
        await removeTorrent(ctx, source, settings, t.hash, false) // deleteFiles=false，永不删数据
        removed++
        items.push({ hash: t.hash, name: t.name, source: source.name, action: 'removed' })
        await ctx.task.log(`${source.name} 已移除任务（数据保留）：${t.name}`)
      } else if (tr) {
        kept++
        items.push({ hash: t.hash, name: t.name, source: source.name, action: 'kept', note: `TR 校验 ${Math.round(Number(tr.percentDone) * 100)}%` })
      } else {
        notInTr++
        items.push({ hash: t.hash, name: t.name, source: source.name, action: 'not_in_tr' })
      }
    }
  }
  const summary = { at: new Date().toISOString(), removed, kept, not_in_tr: notInTr, items }
  await ctx.storage.set('last_cleanup', summary)
  await ctx.task.update({ stage: 'done', message: `移除 ${removed}，保留 ${kept}，未在 TR ${notInTr}`, done: sources.length })
  return summary
}

export async function run(ctx, input = {}) {
  if (input.cleanup === true) return cleanupQb(ctx)
  const settings = await ctx.settings.get()
  const dryRun = settings.dry_run !== false
  const verifyAfter = settings.verify_after_add !== false
  const paused = settings.start_paused === true
  const cleanup = settings.remove_from_qb === true
  const backup = settings.keep_torrent_backup !== false
  const sources = parseSources(settings)
  if (!sources.length) throw new Error('没有可用的 qBittorrent 源，请先在设置里填写 qb_sources')
  const rules = parsePathMap(settings)

  const wanted = Array.isArray(input.hashes) && input.hashes.length ? new Set(input.hashes.map(h => String(h).toLowerCase())) : null
  const ledger = await loadLedger(ctx)

  // 逐个源取已完成种子，保留“这个 hash 属于哪个 qB”
  await ctx.task.update({ stage: 'scan', message: '读取各 qB 已完成种子' })
  const candidates = []
  const seen = new Set()
  for (const source of sources) {
    try {
      await login(ctx, source, settings)
      const list = await torrentList(ctx, source, settings, { filter: 'all' })
      for (const t of list) {
        if (t.progress < 1) continue
        if (wanted && !wanted.has(t.hash)) continue
        if (seen.has(t.hash)) continue
        seen.add(t.hash)
        candidates.push({ source, t })
      }
    } catch (error) {
      await ctx.task.log(`${source.name} 读取失败：${(error && error.message) || error}`)
    }
  }

  let targets = candidates
  const retryHours = Number(settings.retry_hours) || 0
  const nowMs = Date.now()
  if (!wanted && !input.all) {
    const exist = await whichExist(ctx, settings, targets.map(c => c.t.hash))
    // 只有“加入后仍在进行/已确认成功”的阶段才需要跳过；plan/exported 都是还没真正动手，应当重试
    const DONE_STAGES = new Set(['verified', 'seeding', 'cleaned'])
    targets = targets.filter(c => {
      if (exist[c.t.hash]) return false
      const entry = ledger[c.t.hash]
      if (!entry) return true
      if (DONE_STAGES.has(entry.stage)) return false
      // 上一次“加入后”失败（added 阶段）：按冷却时间跳过，避免每轮都撞同一颗坏种
      if (entry.stage === 'added' && entry.at) {
        if (!retryHours) return false
        return nowMs - Date.parse(entry.at) > retryHours * 3600000
      }
      return true
    })
  }
  const cap = Math.max(1, Number(settings.max_per_run) || 20)
  if (targets.length > cap) {
    await ctx.task.log(`本轮限制 ${cap} 个（共 ${targets.length} 个待处理），其余留到下一轮`)
    targets = targets.slice(0, cap)
  }

  const summary = { dry_run: dryRun, total: targets.length, added: 0, skipped: 0, failed: 0, removed_from_qb: 0, rolled_back: 0, items: [] }
  await ctx.task.update({ stage: 'transfer', total: targets.length, done: 0, failed: 0, message: `待处理 ${targets.length} 个` })

  // TR 看不到的目标目录：直接跳过，不浪费一次“加入→校验→回滚”
  const dirCache = new Map()
  const canSee = async (dir) => {
    if (!dir) return true
    if (dirCache.has(dir)) return dirCache.get(dir)
    let ok = true
    try { ok = await canSeeDir(ctx, settings, dir) } catch { ok = true }
    dirCache.set(dir, ok)
    return ok
  }

  for (const { source, t } of targets) {
    const targetDir = mapPath(source, settings, t.save_path, rules)
    const item = { hash: t.hash, name: t.name, size: t.size, source: source.name, save_path: t.save_path, target_dir: targetDir, action: '', stage: STAGE.PLAN, note: '' }
    const mark = async (stage, note) => {
      item.stage = stage
      if (note) item.note = note
      ledger[t.hash] = { stage, at: new Date().toISOString(), name: t.name, source: source.name, target_dir: targetDir, note: item.note }
      await saveLedger(ctx, ledger)
    }

    try {
      const existBefore = await whichExist(ctx, settings, [t.hash])
      if (existBefore[t.hash]) {
        item.action = 'skip'
        item.note = `TR 已有该任务（${Math.round(Number(existBefore[t.hash].percentDone) * 100)}%）`
        summary.skipped++
        summary.items.push(item)
        await mark(STAGE.SEEDING, item.note)
        continue
      }

      if (!(await canSee(targetDir))) {
        item.action = 'skip'
        item.note = `TR 看不到目标目录 ${targetDir || '(空)'}：先给 TR 挂载同一个卷，或改 path_map`
        summary.skipped++
        summary.items.push(item)
        await mark(STAGE.PLAN, item.note)
        await ctx.task.log(`「${t.name}」${item.note}`)
        continue
      }

      if (dryRun) {
        item.action = 'plan'
        item.note = `试运行：${source.name} → TR${verifyAfter ? ' → 校验' : ''}${cleanup ? ' → 通过后从 qB 移除（保留数据）' : ''}`
        summary.items.push(item)
        continue
      }

      await ctx.task.checkpoint({ stage: 'export', hash: t.hash, name: t.name, source: source.name })
      const metainfo = await exportTorrent(ctx, source, settings, t.hash)
      if (backup) await backupTorrent(ctx, t.hash, metainfo)
      await mark(STAGE.EXPORTED, '已导出种子')

      await ctx.task.checkpoint({ stage: 'adding', hash: t.hash, name: t.name, source: source.name, target_dir: targetDir })
      const added = await add(ctx, settings, { metainfo, downloadDir: targetDir, paused: true })
      if (added.duplicate) {
        item.action = 'skip'; item.note = 'TR 报告种子已存在'; summary.skipped++
        summary.items.push(item); await mark(STAGE.SEEDING, item.note); continue
      }
      await mark(STAGE.ADDED, '已加入 TR（暂停）')

      if (verifyAfter) {
        await verify(ctx, settings, t.hash)
        const check = await waitVerified(ctx, settings, t.hash)
        if (!check.ok) {
          await rollback(ctx, settings, t.hash)
          item.action = 'fail'; item.note = `${check.reason}；已回滚 TR 任务，${source.name} 未动`
          summary.failed++; summary.rolled_back++
          summary.items.push(item); await mark(STAGE.ADDED, item.note)
          await ctx.task.log(`「${t.name}」${item.note}`); continue
        }
        await mark(STAGE.VERIFIED, '校验 100%')
      }

      const after = await whichExist(ctx, settings, [t.hash])
      const trItem = after[t.hash]
      if (!trItem) {
        await rollback(ctx, settings, t.hash)
        item.action = 'fail'; item.note = 'TR 查不到刚加入的任务；已回滚，源未动'
        summary.failed++; summary.rolled_back++
        summary.items.push(item); await mark(STAGE.ADDED, item.note); continue
      }
      if (!dirOk(trItem, targetDir)) {
        await rollback(ctx, settings, t.hash)
        item.action = 'fail'
        item.note = `TR 下载目录为 ${trItem.downloadDir || '未知'}，与期望 ${targetDir || '同路径'} 不一致；已回滚，源未动`
        summary.failed++; summary.rolled_back++
        summary.items.push(item); await mark(STAGE.ADDED, item.note)
        await ctx.task.log(`「${t.name}」${item.note}`); continue
      }

      if (!paused) await start(ctx, settings, t.hash)
      await mark(STAGE.SEEDING, paused ? '已就绪（暂停中，等你手动开始）' : '已开始做种')
      item.action = 'added'
      summary.added++

      if (cleanup) {
        const confirm = await whichExist(ctx, settings, [t.hash])
        const c = confirm[t.hash]
        const seeding = c && Number(c.percentDone) >= 1 && (paused || Number(c.status) === 6 || Number(c.status) === 4)
        if (!seeding) {
          item.note += ' TR 尚未确认做种，源保留不动'
          await ctx.task.log(`「${t.name}」未确认做种，跳过清理`)
        } else {
          await removeTorrent(ctx, source, settings, t.hash, false)
          summary.removed_from_qb++
          item.note += `；已从 ${source.name} 移除任务（数据保留）`
          await mark(STAGE.CLEANED, '已移除源任务，数据保留')
          await ctx.task.log(`「${t.name}」已从 ${source.name} 移除任务（不删数据）`)
        }
      } else {
        item.note += `；${source.name} 保留（按设置不清理）`
      }

      summary.items.push(item)
      await ctx.task.update({ done: summary.added, failed: summary.failed, message: t.name })
    } catch (error) {
      item.action = 'fail'
      item.note = String((error && error.message) || error)
      summary.failed++
      summary.items.push(item)
      await mark(STAGE.ADDED, item.note)
      await ctx.task.log(`「${t.name}」失败：${item.note}`)
      await ctx.task.update({ done: summary.added, failed: summary.failed, message: t.name })
    }
    await ctx.sleep(800)
  }

  await ctx.storage.set('last_transfer', { at: new Date().toISOString(), ...summary })
  return summary
}

export async function recover(ctx, checkpoint) {
  if (checkpoint && (checkpoint.stage === 'adding' || checkpoint.stage === 'export')) {
    await ctx.task.log(`上次中断在「${checkpoint.name || checkpoint.hash}」的${checkpoint.stage === 'adding' ? '加入 TR' : '导出种子'}阶段：请先在 TR 核对该 hash 是否存在，再决定是否重跑`)
    return { action: 'attention' }
  }
  return { action: 'resume' }
}
