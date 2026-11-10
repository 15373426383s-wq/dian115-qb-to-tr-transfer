// Transmission RPC 客户端。
// 握手：POST 拿到 409 + X-Transmission-Session-Id，带上该头重发；sid 存进插件存储复用。
const base = settings => String(settings.tr_url || '').replace(/\/+$/, '')
const net = settings => (settings.proxy ? { proxy: settings.proxy } : { proxy: 'direct' })

function header(r, name) {
  const target = String(name).toLowerCase()
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (String(k).toLowerCase() === target) return Array.isArray(v) ? v[0] : String(v)
  }
  return ''
}

function authHeaders(ctx, settings) {
  if (!settings.tr_username) return {}
  const raw = String(settings.tr_username) + ':' + String(settings.tr_password || '')
  return { Authorization: ['Basic ' + ctx.codec.base64Encode(ctx.codec.utf8Encode(raw))] }
}

export async function call(ctx, settings, method, args = {}) {
  const url = base(settings)
  if (!url) throw new Error('未配置 Transmission 地址')
  let sid = (await ctx.storage.get('tr_sid')) || ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = { ...authHeaders(ctx, settings) }
    if (sid) headers['X-Transmission-Session-Id'] = [sid]
    const r = await ctx.http.request({
      url: url + '/transmission/rpc',
      method: 'POST',
      json: { method, arguments: args },
      headers,
      session: 'transmission',
      timeout_seconds: 60,
      ...net(settings),
    })
    if (r.status === 409) {
      const fresh = header(r, 'x-transmission-session-id')
      if (!fresh) throw new Error('Transmission 返回 409 但没有给出会话 ID')
      sid = fresh
      await ctx.storage.set('tr_sid', sid)
      continue
    }
    if (r.status === 401) throw new Error('Transmission 认证失败：检查 RPC 用户名/密码')
    if (r.status >= 400) throw new Error('Transmission HTTP ' + r.status)
    let data = r.data
    if (!data) {
      try { data = JSON.parse(r.body) } catch { throw new Error('Transmission 返回了非 JSON 内容，确认地址是 RPC 端口') }
    }
    if (data.result !== 'success') throw new Error('Transmission 报错：' + (data.result || 'unknown'))
    return data.arguments || {}
  }
  throw new Error('Transmission 会话握手失败（连续 409）')
}

// 目标目录对 TR 是否可见（只读探测，不会创建或改动任何东西）
export async function canSeeDir(ctx, settings, path) {
  if (!path) return true
  try {
    await call(ctx, settings, 'free-space', { path })
    return true
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/no such file|not a directory|不存在/i.test(msg)) return false
    throw error
  }
}

// 返回 { hashString: {percentDone, status, downloadDir} }
export async function whichExist(ctx, settings, hashes) {
  if (!hashes.length) return {}
  const out = {}
  const args = { ids: hashes.slice(0, 500), fields: ['hashString', 'percentDone', 'status', 'downloadDir', 'name'] }
  const res = await call(ctx, settings, 'torrent-get', args)
  for (const t of res.torrents || []) out[String(t.hashString || '').toLowerCase()] = t
  return out
}

export async function add(ctx, settings, { metainfo, downloadDir, paused }) {
  const args = { metainfo, paused: Boolean(paused) }
  if (downloadDir) args['download-dir'] = downloadDir
  const res = await call(ctx, settings, 'torrent-add', args)
  if (res['torrent-duplicate']) return { duplicate: true, hash: String(res['torrent-duplicate'].hashString || '').toLowerCase() }
  const added = res['torrent-added'] || {}
  return { duplicate: false, hash: String(added.hashString || '').toLowerCase(), id: added.id }
}

export async function verify(ctx, settings, hash) {
  await call(ctx, settings, 'torrent-verify', { ids: [hash] })
}

export async function start(ctx, settings, hash) {
  await call(ctx, settings, 'torrent-start', { ids: [hash] })
}

// 轮询直到校验结束：
//   - percentDone >= 1 → 成功
//   - 校验跑过一轮但数据仍不完整 → 立刻失败（不要空等 10 分钟）
export async function waitVerified(ctx, settings, hash, { tries = 90, intervalMs = 5000 } = {}) {
  let started = false
  for (let i = 0; i < tries; i++) {
    if (typeof ctx.remaining === 'function' && ctx.remaining() < intervalMs + 15000) return { ok: false, reason: '任务时间预算不足' }
    const one = await whichExist(ctx, settings, [hash])
    const t = one[hash]
    if (!t) return { ok: false, reason: 'TR 里找不到该任务' }
    const pct = Number(t.percentDone) || 0
    const st = Number(t.status) // 0 停止 / 1 待校验 / 2 校验中 / 3 待下载 / 4 下载中 / 5 待做种 / 6 做种
    if (pct >= 1) return { ok: true, percent: pct }
    if (st === 1 || st === 2) { started = true }
    else if (started || i >= 3) {
      return { ok: false, reason: `校验后仍只有 ${Math.round(pct * 100)}%，目标目录里的数据与种子不匹配` }
    }
    await ctx.sleep(intervalMs)
  }
  return { ok: false, reason: '等待校验超时' }
}
