// 转移做种
//
//   qB 取已完成种子(progress>=1 && amount_left<=0) → 读 .torrent →
//   TR 加种子(paused=True, download_dir) → 删源任务(不删文件)
//   校验完成后把 percentDone==1 且停止的任务 start。
//
// 不判断"部分下载/跳过文件"，不设 files-unwanted，不强制校验，不回滚。
import { parseSources, parsePathMap, mapPath } from './lib/sources.js'
import { login, torrentList, exportTorrent, removeTorrent } from './lib/qb.js'
import { whichExist, add, call, verify } from './lib/tr.js'

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

// 本插件转移任务的标签
export const TRANSFER_LABEL = 'QB转TR'

// 定时把本插件转移的、校验完成(percentDone==1)且停止的任务开始做种。
// 只处理带 TRANSFER_LABEL 的任务。
export async function recheck(ctx) {
  const settings = await ctx.settings.get()
  const res = await call(ctx, settings, 'torrent-get', {
    fields: ['hashString', 'name', 'status', 'percentDone', 'error', 'labels'],
  })
  const all = res.torrents || []
  const mine = all.filter(t => (t.labels || []).some(l => l === TRANSFER_LABEL))
  const ready = mine.filter(t => Number(t.percentDone) >= 1 && Number(t.status) === 0 && Number(t.error) === 0)
  if (ready.length) {
    const ids = ready.map(t => t.hashString)
    await call(ctx, settings, 'torrent-start', { ids })
    await ctx.task.log(`本插件 ${ids.length} 个校验完成，开始做种`)
  } else if (mine.length) {
    await ctx.task.log(`TR 检查：本插件任务 ${mine.length} 个，校验中…`)
  }
  // remaining：本插件已加进 TR、但还没做种的任务数（仍在校验/未到100%/报错）
  const remaining = mine.filter(t => !(Number(t.percentDone) >= 1 && Number(t.status) === 0 && Number(t.error) === 0)).length
  return { checked: mine.length, started: ready.length, remaining }
}

// 清 0：把「TR 里已有」的 qB 任务删掉（不删数据），作为补偿——
// 之前失败残留的、或者 TR 已存在同 hash 的都清掉。
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
  //   进度 100% 且剩余量为 0，且 state 不在「校验中/下载中/移动/错误」等状态。
  //   不判断"部分下载/跳过文件"——热更剧集一集集下是正常形态。
  const BUSY = new Set(['allocating','checkingdl','checkingup','downloading','error','forceddl','missingfiles','metadl','moving','queueddl','stalleddl','unknown'])
  const candidates = []
  const seen = new Set()
  for (const source of sources) {
    try {
      await login(ctx, source, settings)
      const list = await torrentList(ctx, source, settings, { filter: 'all' })
      for (const t of list) {
        if (t.progress < 1) continue
        if (t.amount_left > 0) continue
        if (BUSY.has(String(t.state || '').toLowerCase())) continue
        if (wanted && !wanted.has(t.hash)) continue
        if (seen.has(t.hash)) continue
        seen.add(t.hash)
        candidates.push({ source, t })
      }
    } catch (error) {
      await ctx.task.log(`${source.name} 读取失败：${(error && error.message) || error}`)
    }
  }

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

      // 加(暂停, download_dir) 后，主动 torrent-verify，再由校验轮询启动做种。
      await ctx.task.checkpoint({ stage: 'adding', hash: t.hash, name: t.name, source: source.name, target_dir: targetDir })
      const added = await add(ctx, settings, { metainfo, downloadDir: targetDir, paused: true, labels: [TRANSFER_LABEL] })
      if (added.duplicate) {
        item.action = 'skip'; item.note = 'TR 报告种子已存在'
        summary.skipped++; summary.items.push(item); continue
      }
      const hash = added.hash || t.hash
      try { await verify(ctx, settings, hash) } catch (e) { await ctx.task.log(`校验触发失败（将靠 recheck 兜底）：${e.message || e}`) }
      item.note = '已加入 TR 并触发校验'

      // 加进去(暂停)即算成功，TR 自己会校验；末尾轮询负责后续 start
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

  // 转移流程末尾自带校验轮询：等待 TR 校验完成并立即启动做种——
  // 小种子几秒、大种子也就等校验那一下，不论大小都很快做种。
  if (summary.added > 0) {
    let started = 0
    try {
      // 最多轮询约 3 分钟（20 次 × 10 秒）：TR verify 一般远快于此
      for (let i = 0; i < 20; i++) {
        const rr = await recheck(ctx)
        started += rr.started || 0
        if (!rr.remaining) break
        await ctx.sleep(10000)
      }
      summary.started = started
      if (started > 0) await ctx.task.log(`本轮已启动做种 ${started} 个${summary.added > started ? `（不足部分可能仍在校验，auto 会继续兜底）` : ''}`)
    } catch (e) { await ctx.task.log('recheck 失败（auto 会兜底）：' + ((e && e.message) || e)) }
  }

  await ctx.storage.set('last_transfer', summary)
  await ctx.task.update({ stage: 'done', message: `加入 ${summary.added}，跳过 ${summary.skipped}，失败 ${summary.failed}，清源 ${summary.removed_from_qb}${summary.started ? `，做种 ${summary.started}` : ''}`, done: summary.added })
  return summary
}

export async function recover(ctx, checkpoint) {
  if (checkpoint && (checkpoint.stage === 'adding' || checkpoint.stage === 'export')) {
    await ctx.task.log(`上次中断在「${checkpoint.name || ''}」加入阶段，请先在 TR 核对是否已存在，再决定是否重跑`)
    return { action: 'attention' }
  }
  return { action: 'resume' }
}
