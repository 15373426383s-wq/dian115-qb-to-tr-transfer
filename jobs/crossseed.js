// 针对 TR 的辅种：扫描一个目录下的 .torrent 文件，逐个加入 Transmission 做种。
// 适用：数据文件已在（qB/MoviePilot 已下载，或已转移到 TR），再用另一份/另一站点的
// .torrent 给 TR 补种，刷多站分享率。
//
// 安全链路与迁移一致：先暂停加入 → 校验 → 校验通过做种 → 失败回滚；处理完的 .torrent
// 移入 done/ 子目录，绝不删数据，绝不删原 .torrent（除非 move 本身就是挪走）。
import { add, verify, start, waitVerified, call } from './lib/tr.js'

const DONE = 'done'
const FAIL = 'failed'

async function listTorrentFiles(ctx, dir) {
  const raw = await ctx.files.call({ operation: 'list', path: dir })
  const arr = Array.isArray(raw) ? raw : (raw && (raw.entries || raw.items || raw.files)) || []
  return arr.filter(f => !f.is_dir && /\.torrent$/i.test(String(f.name || f.path || '')))
}

export async function run(ctx, input = {}) {
  const settings = await ctx.settings.get()
  const dir = String(settings.cross_seed_dir || '').replace(/\/+$/, '')
  if (!dir) throw new Error('未配置辅种种子目录（cross_seed_dir），请先在设置里填写')
  const dataDir = String(settings.cross_seed_data_dir || '').replace(/\/+$/, '')
  const verifyAfter = settings.verify_after_add !== false
  const paused = settings.start_paused === true
  const dryRun = settings.dry_run !== false

  const files = await listTorrentFiles(ctx, dir)
  if (!files.length) { await ctx.task.log(`目录 ${dir} 下没有 .torrent 文件`); return { total: 0, added: 0, skipped: 0, failed: 0 } }

  const summary = { at: new Date().toISOString(), dry_run: dryRun, total: files.length, added: 0, skipped: 0, failed: 0, rolled_back: 0, items: [] }
  await ctx.task.update({ stage: 'crossseed', total: files.length, done: 0, failed: 0, message: `辅种 ${files.length} 个` })

  for (const f of files) {
    const name = String(f.name || '')
    const path = String(f.path || (dir + '/' + name))
    const item = { name, path, target_dir: dataDir || '(TR 默认)', action: '', note: '' }
    try {
      // 读 .torrent 为 base64（单文件 < 16 MiB）
      const rd = await ctx.files.call({ operation: 'read', path, encoding: 'base64' })
      let b64 = ''
      if (typeof rd === 'string') b64 = rd
      else if (rd && typeof rd === 'object') b64 = rd.content || rd.body_base64 || rd.value || rd.body || rd.data || ''
      b64 = String(b64).replace(/^data:[^;]+,/, '')
      if (!b64) throw new Error('读取种子内容失败')

      if (dryRun) {
        item.action = 'plan'
        item.note = `试运行：将加入 TR → ${dataDir || '默认目录'}${verifyAfter ? ' → 校验' : ''}`
        summary.items.push(item)
        continue
      }

      await ctx.task.checkpoint({ stage: 'adding', name, path })
      const res = await add(ctx, settings, { metainfo: b64, downloadDir: dataDir, paused: true })
      if (res.duplicate) {
        item.action = 'skip'; item.note = 'TR 已有同 hash 任务'
        summary.skipped++; summary.items.push(item)
        await move(ctx, path, dir, DONE, name)
        continue
      }
      const hash = res.hash
      if (!hash) { item.action = 'fail'; item.note = 'TR 未返回 hash'; summary.failed++; summary.items.push(item); continue }

      if (verifyAfter) {
        await verify(ctx, settings, hash)
        const check = await waitVerified(ctx, settings, hash)
        if (!check.ok) {
          await rollback(ctx, settings, hash)
          item.action = 'fail'; item.note = check.reason + '；已回滚 TR 任务'
          summary.failed++; summary.rolled_back++; summary.items.push(item)
          await move(ctx, path, dir, FAIL, name)
          continue
        }
        if (!paused) await start(ctx, settings, hash)
        item.note = '校验通过' + (paused ? '（暂停中）' : '，开始做种')
      } else if (!paused) {
        await start(ctx, settings, hash)
        item.note = '已加入并开始'
      } else {
        item.note = '已加入（暂停中）'
      }

      item.action = 'added'
      summary.added++
      summary.items.push(item)
      await move(ctx, path, dir, DONE, name)
      await ctx.task.log(`辅种「${name}」→ ${dataDir || '默认目录'}：${item.note}`)
    } catch (error) {
      item.action = 'fail'
      item.note = String((error && error.message) || error)
      summary.failed++
      summary.items.push(item)
      await ctx.task.log(`「${name}」辅种失败：${item.note}`)
    }
    await ctx.task.update({ done: summary.added, failed: summary.failed, message: name })
  }

  await ctx.storage.set('last_crossseed', summary)
  return summary
}

async function move(ctx, path, dir, sub, name) {
  try {
    await ctx.files.call({ operation: 'mkdir', path: dir + '/' + sub })
    await ctx.files.call({ operation: 'move', path, destination: dir + '/' + sub + '/' + name, overwrite: false })
  } catch (error) {
    await ctx.task.log(`移动种子文件失败（不影响结果）：${(error && error.message) || error}`)
  }
}

async function rollback(ctx, settings, hash) {
  try { await call(ctx, settings, 'torrent-remove', { ids: [hash], 'delete-local-data': false }) }
  catch (error) { await ctx.task.log(`回滚失败：${(error && error.message) || error}`) }
}

export async function recover(ctx, checkpoint) {
  if (checkpoint && checkpoint.stage === 'adding') {
    await ctx.task.log(`上次中断在「${checkpoint.name || ''}」加入阶段，请先在 TR 核对是否已存在，再决定是否重跑`)
    return { action: 'attention' }
  }
  return { action: 'resume' }
}
