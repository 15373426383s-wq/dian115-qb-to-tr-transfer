import { parseSources, parsePathMap, mapPath } from './lib/sources.js'
import { login, torrentList } from './lib/qb.js'
import { whichExist, canSeeDir } from './lib/tr.js'

export const CANDIDATE_KEY = 'candidates'

export async function run(ctx) {
  const settings = await ctx.settings.get()
  const sources = parseSources(settings)
  if (!sources.length) throw new Error('没有可用的 qBittorrent 源：请在设置里按“名称|地址|用户名|密码|路径前缀|APIKey|分类”一行一个填写')
  const rules = parsePathMap(settings)

  const items = []
  const failed = []
  const pathStats = []
  for (const source of sources) {
    await ctx.task.update({ stage: 'qb', message: `登录 ${source.name}` })
    try {
      await login(ctx, source, settings)
      const list = await torrentList(ctx, source, settings, { filter: 'all' })
      const done = list.filter(t => t.progress >= 1)
      const byPath = new Map()
      for (const t of done) {
        byPath.set(t.save_path, (byPath.get(t.save_path) || 0) + 1)
        items.push({
          source: source.name,
          sourceKey: source.key,
          hash: t.hash,
          name: t.name,
          size: t.size,
          save_path: t.save_path,
          target_dir: mapPath(source, settings, t.save_path, rules),
          ratio: t.ratio,
          state: t.state,
          category: t.category,
          tags: t.tags,
        })
      }
      for (const [p, c] of byPath) pathStats.push({ source: source.name, path: p, count: c, mapped: mapPath(source, settings, p, rules) })
      await ctx.task.log(`${source.name}：${list.length} 个种子，已完成 ${done.length} 个，路径根 ${byPath.size} 个`)
    } catch (error) {
      failed.push({ source: source.name, error: String((error && error.message) || error) })
      await ctx.task.log(`${source.name} 读取失败：${(error && error.message) || error}`)
    }
  }

  // 同一个 hash 可能同时出现在多个 qB（交叉做种），按 hash 去重后只保留第一个来源
  const byHash = new Map()
  for (const it of items) if (!byHash.has(it.hash)) byHash.set(it.hash, it)
  const unique = Array.from(byHash.values())

  await ctx.task.update({ stage: 'tr', message: '比对 Transmission', total: unique.length, done: 0 })
  const existing = await whichExist(ctx, settings, unique.map(t => t.hash))

  // 目标目录对 TR 是否可见：同目录只探一次，避免几百次 RPC
  const dirCache = new Map()
  const visible = async (dir) => {
    if (!dir) return true
    if (dirCache.has(dir)) return dirCache.get(dir)
    let ok = true
    try { ok = await canSeeDir(ctx, settings, dir) } catch { ok = true } // 探测本身出错就不拦，交给运行时校验
    dirCache.set(dir, ok)
    return ok
  }

  for (const it of unique) {
    const hit = existing[it.hash]
    it.in_tr = Boolean(hit)
    it.tr_percent = hit ? Number(hit.percentDone) : null
    it.tr_dir = hit ? String(hit.downloadDir || '') : ''
    it.tr_dir_ok = hit ? true : await visible(it.target_dir)
  }

  const pending = unique.filter(i => !i.in_tr)
  await ctx.storage.set(CANDIDATE_KEY, {
    at: new Date().toISOString(),
    sources: sources.map(s => s.name),
    failed,
    pathStats,
    total: unique.length,
    items: unique,
  })
  await ctx.task.update({ stage: 'done', message: `已完成 ${unique.length} 个，待转移 ${pending.length} 个`, done: unique.length })
  return { sources: sources.length, failed: failed.length, completed: unique.length, pending: pending.length }
}

export async function recover() {
  return { action: 'resume' }
}
