// qBittorrent WebUI API 客户端：多实例、独立会话，支持密码登录与 API Key 两种认证。
const ses = source => 'qb:' + source.key
const net = settings => (settings.proxy ? { proxy: settings.proxy } : { proxy: 'direct' })

function parse(text) {
  try { return JSON.parse(text) } catch { throw new Error('qBittorrent 返回了非 JSON 内容，确认地址指向 WebUI 而不是别的服务') }
}

function authHeaders(source) {
  return source.apiKey ? { Authorization: ['Bearer ' + source.apiKey] } : {}
}

// 密码认证才需要登录；API Key 认证直接用请求头
export async function login(ctx, source, settings) {
  if (source.apiKey) {
    const r = await ctx.http.request({
      url: source.url + '/api/v2/app/version',
      headers: authHeaders(source),
      session: ses(source),
      timeout_seconds: 15,
      ...net(settings),
    })
    if (r.status === 401 || r.status === 403) throw new Error(`${source.name} 的 API Key 无效（HTTP ${r.status}）`)
    if (r.status >= 400) throw new Error(`${source.name} 连接失败：HTTP ${r.status}`)
    return true
  }
  const url = source.url
  const r = await ctx.http.request({
    url: url + '/api/v2/auth/login',
    method: 'POST',
    form: { username: source.user || '', password: source.pass || '' },
    headers: { Referer: [url], Origin: [url] },
    session: ses(source),
    timeout_seconds: 20,
    ...net(settings),
  })
  if (r.status === 403) throw new Error(`${source.name} 拒绝登录（HTTP 403）：可能触发了 IP 临时封禁，先在 WebUI 解除或把本机加入白名单`)
  // qB 4.x 返回 200 + "Ok."；qB 5.x 返回 204 + 空体，两者都算成功
  if (r.status === 204) return true
  if (r.status !== 200) throw new Error(`${source.name} 登录失败：HTTP ${r.status}`)
  const text = String(r.body || '').trim()
  if (text && text !== 'Ok.') throw new Error(`${source.name} 用户名或密码不正确`)
  return true
}

async function call(ctx, source, settings, path, options = {}) {
  const once = () => ctx.http.request({
    url: source.url + path,
    session: ses(source),
    headers: { ...authHeaders(source), ...(options.headers || {}) },
    timeout_seconds: options.timeout_seconds || 30,
    ...net(settings),
    ...options,
  })
  let r = await once()
  if (r.status === 401 || r.status === 403) { await login(ctx, source, settings); r = await once() }
  if (r.status === 404) throw new Error(`${source.name} 接口不存在：${path}（版本过旧？）`)
  if (r.status >= 400) throw new Error(`${source.name} ${path} 返回 HTTP ${r.status}`)
  return r
}

export async function torrentList(ctx, source, settings, { filter = 'completed' } = {}) {
  const params = ['filter=' + encodeURIComponent(filter), 'sort=added_on', 'reverse=false']
  const category = source.category || settings.qb_category
  if (category) params.push('category=' + encodeURIComponent(category))
  if (settings.qb_tag) params.push('tag=' + encodeURIComponent(settings.qb_tag))
  const r = await call(ctx, source, settings, '/api/v2/torrents/info?' + params.join('&'))
  const list = parse(r.body || '[]')
  return (Array.isArray(list) ? list : []).map(t => ({
    source: source.name,
    sourceKey: source.key,
    hash: String(t.hash || '').toLowerCase(),
    name: String(t.name || ''),
    size: Number(t.size) || 0,
    progress: Number(t.progress) || 0,
    amount_left: Number(t.amount_left) || 0,
    state: String(t.state || ''),
    save_path: String(t.save_path || ''),
    category: String(t.category || ''),
    tags: String(t.tags || ''),
    ratio: Number(t.ratio) || 0,
  })).filter(t => t.hash)
}

// 文件列表：索引顺序与 .torrent 内一致，用于把「不下载」的文件同步给 TR
export async function torrentFiles(ctx, source, settings, hash) {
  const r = await call(ctx, source, settings, '/api/v2/torrents/files?hash=' + encodeURIComponent(hash))
  const list = parse(r.body || '[]')
  return (Array.isArray(list) ? list : []).map((f, i) => ({
    index: i,
    name: String(f.name || ''),
    size: Number(f.size) || 0,
    priority: Number(f.priority),
    progress: Number(f.progress) || 0,
  }))
}

export async function exportTorrent(ctx, source, settings, hash) {
  const r = await call(ctx, source, settings, '/api/v2/torrents/export?hash=' + encodeURIComponent(hash), {
    response_type: 'base64',
    timeout_seconds: 120,
  })
  const b64 = r.body_base64 || ''
  if (!b64) throw new Error(`${source.name} 没返回种子文件：任务可能仍在获取元数据`)
  return b64
}

// 只删任务，不删数据
export async function removeTorrent(ctx, source, settings, hash, deleteFiles = false) {
  await call(ctx, source, settings, '/api/v2/torrents/delete', {
    method: 'POST',
    form: { hashes: hash, deleteFiles: deleteFiles ? 'true' : 'false' },
    timeout_seconds: 60,
  })
}
