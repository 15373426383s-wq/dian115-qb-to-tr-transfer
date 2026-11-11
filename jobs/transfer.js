// 转移做种 —— 参考 MoviePilot torrenttransfer 的简洁模型
//
//   qB 已完成 → 导出 .torrent → TR add(暂停, download_dir) → 立即删 qB 任务(不删文件)
//   TR 自己校验；独立的 recheck 任务把「校验完成且暂停」的启动做种。
//
// 不再做「不到 100% 就回滚」：部分下载的种子 qB 里跳过了文件，TR 里用
// files-unwanted 同步同样的跳过列表即可按已下载内容做种，不需要、也不应该
// 强行要求全量 100%。
import { parseSources, parsePathMap, mapPath } from './lib/sources.js'
import { login, torrentList, exportTorrent, removeTorrent, torrentFiles } from './lib/qb.js'
import { whichExist, add, call } from './lib/tr.js'

const LEDGER_KEY = 'ledger'
const BACKUP_PREFIX = 'torrent:'
const BACKUP_MAX = 50

async function loadLedger(ctx) { return (await ctx.storage.get(LEDGER_KEY)) || {} }
async function saveLedger(ctx, ledger) {
  const keys = Object.keys(ledger)
  if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete ledger[k]
  await ctx.storage.set(LEDGER_KEY, ledger)
}
async function backupTorrent(ctx, hash, b64) {
  const index = (await ctx.storage.get('backup_index')) || []
  await ctx.storage.set(BACKUP_PREFIX + hash, b64)
  if (!index.includes(hash)) index.push(hash)
  while (index.length > BACKUP_MAX) { const drop = index.shift(); await ctx.storage.set(BACKUP_PREFIX + drop, null) }
  await ctx.storage.set('backup_index', index)
}

// MoviePilot 的 __download：源 qB 若有跳过文件，目标 TR 用 files-unwanted 对齐
async function syncSkippedFiles(ctx, settings, hash, unwantedIdx) {
  if (!unwantedIdx || !unwantedIdx.length) return
  await call(ctx, settings, 'torrent-set', { ids: [hash], 'files-unwanted': unwantedIdx })
}

// 定时把 TR 里「校验完成(percentDone==1) 且暂停(停止)」的任务开始做种
export async function recheck(ctx) {
  const settings = await ctx.settings.get()
  const res = await call(ctx, settings, 'torrent-get', {
    fields: ['hashString', 'name', 'status', 'percentDone', 'error'],
  })
  const all = res.torrents || []
  const ready = all.filter(t => Number(t.percentDone) >= 1 && Number(t.status) === 0)
  if (!ready.length) {
    await ctx.task.log(`TR 检查：${all.length} 个任务，无新可做种`)
    return { checked: all.length, started: 0 }
  }
  const ids = ready.map(t => t.hashString)
  await call(ctx, settings, 'torrent-start', { ids })
  await ctx.task.log(`TR 校验完成，开始做种 ${ids.length} 个`)
  return { checked: all.length, started: ids.length }
}

// 清 0：把「TR 里已有」的 qB 任务删掉（不删数据）。MoviePilot 里 deletesource 是加完就删，
// 这里作为补偿——之前失败残留的、或者 TR 已存在同 hash 的都清掉。
export async function cleanupQb(ctx) {
  const settings = await ctx.settings.get()
  const sources = parseSources(settings)
  let removed = 0, kept = 0
  const items = []
  for (const source of sources) {
    await login(ctx, source, settings)
    const list = await torrentList(ctx, source, settings, { filter: 'all' })
    const done = list.filter(t => t.progress >= 1)
    if (!done.length) continue
    const exist = await whichExist(ctx, settings, done.map(t => t.hash))
    for (const t of done) {
      if (exist[t.hash]) {
        await removeTorrent(ctx, source, settings, t.hash, false)
        removed++
        items.push({ hash: t.hash, name: t.name, source: source.name, action: 'removed' })
      } else {
        kept++
        items.push({ hash: t.hash, name: t.name, source: source.name, action: 'kept' })
      }
    }
  }
  const summary = { at: new Date().toISOString(), removed, kept, items }
  await ctx.storage.set('last_cleanup', summary)
  return summary
}

export async function run(ctx, input = {}) {
  if (input.recheck === true) return recheck(ctx)
  if (input.cleanup === true) return cleanupQb(ctx)

  const settings = await ctx.settings.get()
  const dryRun = settings.dry_run !== false
  const cleanup = settings.remove_from_qb === true
  const backup = settings.keep_torrent_backup !== false
  const sources = parseSources(settings)
  const rules = parsePathMap(settings)
  if (!sources.length) throw new Error('没有可用的 qBittorrent 源，请在设置里填写 qb_sources')

  const wanted = Array.isArray(input.hashes) && input.hashes.length ? new Set(input.hashes.map(h => String(h).toLowerCase())) : null
  const ledger = await loadLedger(ctx)
  const cap = Math.max(1, Number(settings.max_per_run) || 20)

  await ctx.task.update({ stage: 'scan', message: '读取各 qB 已完成种子' })
  // 与 MoviePilot torrenttransfer 一致：只转「完整下载」的种子。
  // qB 里 progress=1 但文件列表存在 priority=0（选下部分集 / 跳过文件）的种子，
  // 在 TR 里必然校验不到 100%（跨文件 piece 缺数据），MP 也不会转这类种子。直接跳过、保留在 qB。
  const candidates = []
  const seen = new Set()
  let partialSkipped = 0
  for (const source of sources) {
    try {
      await login(ctx, source, settings)
      const list = await torrentList(ctx, source, settings, { filter: 'all' })
      for (const t of list) {
        if (t.progress < 1) continue
        if (wanted && !wanted.has(t.hash)) continue
        if (seen.has(t.hash)) continue
        // 部分下载检测：有被跳过的文件就不转
        let partial = false
        try {
          const files = await torrentFiles(ctx, source, settings, t.hash)
          if (files.some(f => Number(f.priority) === 0)) partial = true
        } catch { /* 读不到就按完整处理，交给 TR 校验 */ }
        if (partial) { partialSkipped++; continue }
        seen.add(t.hash)
        candidates.push({ source, t })
      }
    } catch (error) {
      await ctx.task.log(`${source.name} 读取失败：${(error && error.message) || error}`)
    }
  }
  if (partialSkipped) await ctx.task.log(`跳过 ${partialSkipped} 个「部分下载」种子（与 MoviePilot 一致，保留在 qB）`)

  // 已在 TR 的跳过（由 cleanup 负责清源），避免重复添加
  let targets = candidates
  if (!wanted) {
    const exist = await whichExist(ctx, settings, targets.map(c => c.t.hash))
    targets = targets.filter(c => !exist[c.t.hash] && !ledger[c.t.hash])
  }
  if (targets.length > cap) { await ctx.task.log(`本轮限制 ${cap} 个（共 ${targets.length} 个）`); targets = targets.slice(0, cap) }

  const summary = { at: new Date().toISOString(), dry_run: dryRun, total: targets.length, added: 0, skipped: 0, failed: 0, removed_from_qb: 0, items: [] }
  await ctx.task.update({ stage: 'transfer', total: targets.length, done: 0, failed: 0, message: `待处理 ${targets.length} 个` })

  for (const { source, t } of targets) {
    const targetDir = mapPath(source, settings, t.save_path, rules)
    const item = { hash: t.hash, name: t.name, source: source.name, target_dir: targetDir, action: '', note: '' }
    try {
      const existBefore = await whichExist(ctx, settings, [t.hash])
      if (existBefore[t.hash]) {
        item.action = 'skip'; item.note = 'TR 已有该任务'
        summary.skipped++; summary.items.push(item); continue
      }
      if (dryRun) {
        item.action = 'plan'; item.note = `试运行：将加入 TR${cleanup ? ' 并清源' : ''}`
        summary.items.push(item); continue
      }

      await ctx.task.checkpoint({ stage: 'export', hash: t.hash, name: t.name, source: source.name })
      const metainfo = await exportTorrent(ctx, source, settings, t.hash)
      if (backup) await backupTorrent(ctx, t.hash, metainfo)

      // qB 里被标记「不下载」的文件索引，TR 用 files-unwanted 对齐（部分下载种子也能做种）
      let unwanted = []
      try {
        const files = await torrentFiles(ctx, source, settings, t.hash)
        unwanted = files.map((f, i) => Number(f.priority) === 0 ? i : -1).filter(i => i >= 0)
      } catch (e) { /* 读不到就按全量处理 */ }

      await ctx.task.checkpoint({ stage: 'adding', hash: t.hash, name: t.name, source: source.name, target_dir: targetDir })
      const added = await add(ctx, settings, { metainfo, downloadDir: targetDir, paused: true })
      if (added.duplicate) {
        item.action = 'skip'; item.note = 'TR 报告种子已存在'
        summary.skipped++; summary.items.push(item); continue
      }
      const hash = added.hash || t.hash
      if (unwanted.length) {
        await syncSkippedFiles(ctx, settings, hash, unwanted)
        item.note = `同步跳过 ${unwanted.length} 个文件`
      }

      // MoviePilot 模型：加进去(暂停)即算成功，TR 自己会校验；recheck 任务负责后续 start
      item.action = 'added'
      summary.added++
      ledger[t.hash] = { at: new Date().toISOString(), stage: 'added', name: t.name, source: source.name }
      await saveLedger(ctx, ledger)

      // 删源任务，不删数据文件
      if (cleanup) {
        await removeTorrent(ctx, source, settings, t.hash, false)
        summary.removed_from_qb++
        item.note += '；已从 qB 移除任务（数据保留）'
      }
      summary.items.push(item)
      await ctx.task.log(`「${t.name}」→ TR（暂停，待校验）${item.note}`)
    } catch (error) {
      item.action = 'fail'; item.note = String((error && error.message) || error)
      summary.failed++; summary.items.push(item)
      await ctx.task.log(`「${t.name}」失败：${item.note}`)
    }
    await ctx.task.update({ done: summary.added, failed: summary.failed, message: t.name })
    await ctx.sleep(300)
  }

  await ctx.storage.set('last_transfer', summary)
  await ctx.task.update({ stage: 'done', message: `加入 ${summary.added}，跳过 ${summary.skipped}，失败 ${summary.failed}，清源 ${summary.removed_from_qb}`, done: summary.added })
  return summary
}

export async function recover(ctx, checkpoint) {
  if (checkpoint && (checkpoint.stage === 'adding' || checkpoint.stage === 'export')) {
    await ctx.task.log(`上次中断在「${checkpoint.name || ''}」加入阶段，请先在 TR 核对是否已存在，再决定是否重跑`)
    return { action: 'attention' }
  }
  return { action: 'resume' }
}
