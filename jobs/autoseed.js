// 自动辅种（参考 IYUU 机制，但用宿主 PT 能力、不依赖中心服务器）。
//
// 链路：
//   1. 从 TR 提取正在做种的种子（标题 + 数据目录 + 体积）
//   2. 用标题核心词调宿主 /api/pt/search（走宿主已配置并启用的 PT 站）
//   3. 匹配：标题含核心词 且 体积差在容差内（同款资源体积应基本一致）
//   4. 调用 /api/pt/download 把该站种子推到 TR 下载器，save_path=原数据目录
//   5. TR 校验本地数据：100% 才是真辅种；对不上回滚（不删数据）
//
// 匹配依据：标题 + 体积；info_hash 宿主搜索不返回，最终由 TR 数据校验兜底。
import { call as trCall } from './lib/tr.js'

const LEDGER_KEY = 'autoseed_ledger'

const SPLIT_RE = /[.\-\[\]()（）【】\s]/

// 提取"主标题"：中文取第一个分隔符前；英文按点分段，去掉年份/分辨率/编码/音轨/来源/制作组等技术标记
const SXX_RE = /^s\d{1,2}(e\d{1,3})?$/i
const RES_RE = /^(2160p|1080p|720p|480p|4k|8k|uhd|hd)$/i
const ENC_RE = /^(h\.?26[45]|x26[45]|hevc|avc|av1)$/i
const SRC_RE = /^(web-dl|webrip|bluray|bdrip|remux|amzn|nf|it|hdtv|dvd|hddvd|hmax|dsnp|atvp|hulu|kktv|wavve|mgttv)$/i
const AUDIO_RE = /^(aac|ac3|eac3|ddp|ddp5\.1|atmos|truehd|dts|dts-hd|flac|opus|mp3|ma5\.1)(\.\d+\.\d+)?$/i

function keywordOf(name) {
  const s = String(name || '').trim()
  // 中文标题：取第一个分隔符前的中文段
  if (/[\u4e00-\u9fa5]/.test(s)) {
    const m = s.match(/^([\u4e00-\u9fa5][^.\-\[\]()（）【】]*)/)
    if (m) return m[1].replace(/[！!～~]+$/, '').trim()
  }
  // 英文标题：点分段，遇到技术标记即停
  const parts = s.split(/[.\s]+/).filter(Boolean)
  const title = []
  for (const p of parts) {
    if (SXX_RE.test(p) || RES_RE.test(p) || ENC_RE.test(p) || SRC_RE.test(p) || /^(19|20)\d{2}$/.test(p)) break
    if (AUDIO_RE.test(p) && title.length) break
    title.push(p)
  }
  return title.join(' ').trim()
}

function titleHit(torrentTitle, keyword) {
  const t = String(torrentTitle || '').toLowerCase().replace(/[.\-]/g, ' ')
  const k = String(keyword || '').toLowerCase()
  if (!k) return false
  return t.includes(k)
}

// 发布组 = 标题末尾的 -XXX / XXX（去掉 .mkv 等扩展名和 @站名后缀）。
// TR 辅种要求文件名完全一致，而文件名一致 ⟺ 发布组一致；跨发布组即使体积相同，
// 文件名不同，TR 必然下载。所以这里要求发布组一致，从根本上避免误推送导致下载。
function groupOf(title) {
  const s = String(title || '').replace(/\.(mkv|mp4|ts|avi|mov)$/i, '').trim()
  const m = s.match(/[-\s]([A-Za-z0-9]+)$/)
  return m ? m[1].replace(/@.*$/, '').toLowerCase() : ''
}

async function loadLedger(ctx) { return (await ctx.storage.get(LEDGER_KEY)) || {} }
async function saveLedger(ctx, ledger) {
  const keys = Object.keys(ledger)
  if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete ledger[k]
  await ctx.storage.set(LEDGER_KEY, ledger)
}

export async function run(ctx, input = {}) {
  const settings = await ctx.settings.get()
  const dryRun = settings.dry_run !== false
  const tolerance = Number(settings.autoseed_size_tolerance ?? 0.001) || 0.001
  const cap = Math.max(1, Number(settings.max_per_run) || 10)

  // 1. TR 正在做种的种子（按 hash 排序，保证每轮游标推进稳定）
  await ctx.task.update({ stage: 'tr', message: '读取 TR 做种列表' })
  const trRes = await trCall(ctx, settings, 'torrent-get', { fields: ['hashString', 'name', 'downloadDir', 'totalSize', 'status'] })
  const seeding = (trRes.torrents || []).filter(t => Number(t.status) === 6).sort((a, b) => String(a.hashString).localeCompare(String(b.hashString)))
  await ctx.task.log(`TR 做种 ${seeding.length} 个`)

  // 游标：每轮只推进 cap 个，扫到末尾回卷；已推送的由 ledger 去重
  const cursorKey = 'autoseed_cursor'
  let cursor = Number(await ctx.storage.get(cursorKey)) || 0
  if (cursor >= seeding.length) cursor = 0
  const batch = seeding.slice(cursor, cursor + cap)
  await ctx.storage.set(cursorKey, cursor + batch.length)

  const ledger = await loadLedger(ctx)
  const summary = { dry_run: dryRun, scanned: 0, matched: 0, submitted: 0, skipped: 0, failed: 0, items: [] }

  for (const t of batch) {
    const keyword = keywordOf(t.name)
    if (!keyword || keyword.length < 2) { summary.skipped++; continue }
    summary.scanned++

    const item = { hash: t.hashString, name: t.name, keyword, download_dir: t.downloadDir, size: Number(t.totalSize) || 0, candidates: [] }
    try {
      // 2. 宿主 PT 搜索
      const sr = await ctx.api.post('/api/pt/search', { keyword, max_pages: 1, stop_when_found: false })
      const torrents = (sr && sr.data && sr.data.torrents) || []

      // 3. 匹配：标题 + 发布组一致 + 体积
      const target = item.size
      const trGroup = groupOf(t.name)
      const hits = torrents.filter(x => {
        if (!titleHit(x.title, keyword)) return false
        if (trGroup && groupOf(x.title) !== trGroup) return false // 跨发布组文件名不同，必然下载，排除
        if (target <= 0) return true
        const sz = Number(x.size) || 0
        if (sz <= 0) return false
        return Math.abs(sz - target) / target <= tolerance
      })
      item.candidates = hits.map(x => ({ site_id: x.site_id, site_name: x.site_name, title: x.title, size: Number(x.size) || 0, seeders: x.seeders, download_url: x.download_url, free_type: x.free_type }))

      if (!hits.length) { item.note = '无体积匹配的同款种子'; summary.items.push(item); continue }

      for (const c of item.candidates) {
        const key = `${t.hashString}|${c.site_id}`
        if (ledger[key]) continue
        if (dryRun) {
          summary.matched++
          item.note = `试运行：可辅到 ${c.site_name}（${c.title}，差 ${pctDiff(c.size, target)}%）`
          continue
        }
        // 4. 宿主推送给 TR，save_path = 原数据目录
        try {
          const dl = await ctx.api.post('/api/pt/download', {
            site_id: c.site_id,
            download_url: c.download_url,
            downloader: 'TR',
            save_path: item.download_dir,
            title: c.title,
          })
          const data = (dl && dl.data) || {}
          if (data && data.success === false) throw new Error(String(data.error || '站点拒绝'))
          if (data && data.state_uncertain === true) { item.note = `${c.site_name} 结果未知，请核对`; summary.failed++; continue }
          ledger[key] = { at: new Date().toISOString(), site: c.site_name, title: c.title }
          await saveLedger(ctx, ledger)
          summary.submitted++
          item.note = `已推送 ${c.site_name}：${c.title}`
        } catch (e) {
          summary.failed++
          item.note = `${c.site_name} 推送失败：${(e && e.message) || e}`
        }
      }
      summary.items.push(item)
    } catch (error) {
      item.note = '搜索失败：' + ((error && error.message) || error)
      summary.failed++
      summary.items.push(item)
    }
    await ctx.sleep(1200) // 搜索节奏，避免触发站点限速
  }

  await ctx.storage.set('last_autoseed', { at: new Date().toISOString(), ...summary })
  await ctx.task.update({ stage: 'done', message: `扫描 ${summary.scanned}，匹配 ${summary.matched}，推送 ${summary.submitted}，失败 ${summary.failed}`, done: summary.scanned })

  // TG 通知：跑完汇总 + 明细（最多 40 行）
  if (settings.notify_enabled !== false && (summary.matched || summary.submitted || summary.failed)) {
    const lines = [`扫描 ${summary.scanned} · 匹配 ${summary.matched} · 推送 ${summary.submitted} · 失败 ${summary.failed}` + (dryRun ? '（试运行）' : '')]
    for (const it of summary.items) {
      const cands = it.candidates || []
      if (!cands.length) continue
      if (dryRun) {
        const sites = [...new Set(cands.map(c => c.site_name))].join('、')
        lines.push(`· ${it.name} → ${sites}`)
      } else if (it.note && it.note.startsWith('已推送')) {
        lines.push(`✔ ${it.name} ${it.note.replace('已推送 ', '→ ')}`)
      } else if (it.note && it.note.includes('失败')) {
        lines.push(`✘ ${it.name} ${it.note}`)
      }
    }
    try {
      await ctx.notify({
        title: '自动辅种' + (dryRun ? '（试运行）' : ''),
        body: lines.slice(0, 40).join('\n'),
        level: summary.failed ? 'warning' : 'success',
        channels: ['telegram'],
        dedupe_key: 'qb2tr:autoseed:' + Date.now(),
      })
    } catch (e) {
      await ctx.task.log('TG 通知发送失败：' + ((e && e.message) || e))
    }
  }
  return summary
}

function pctDiff(a, b) {
  if (!b) return 0
  return Math.round((Math.abs(a - b) / b) * 1000) / 10
}

export async function recover() { return { action: 'resume' } }
