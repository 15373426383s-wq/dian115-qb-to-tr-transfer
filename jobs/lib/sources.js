// 解析多 qB 源 + 多路径映射规则。
// 源格式：名称|地址|用户名|密码|路径前缀|APIKey|只处理该分类
// 映射规则格式（path_map，一行一条）：qB路径前缀 => TR路径前缀
// 匹配时按“最长前缀优先”，所以可以同时配 /music 和 /mc/music 这种同实例多根目录的情况。

export function parseSources(settings) {
  const raw = String(settings.qb_sources || '')
  const fallbackFrom = String(settings.path_from || '').trim().replace(/\/+$/, '')
  const out = []
  for (const line of String(raw).split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const parts = s.split('|').map(x => x.trim())
    const url = parts[1]
    if (!url || !/^https?:\/\//i.test(url)) continue
    out.push({
      name: parts[0] || ('QB' + (out.length + 1)),
      url: url.replace(/\/+$/, ''),
      user: parts[2] || '',
      pass: parts[3] || '',
      pathFrom: (parts[4] || fallbackFrom || '').replace(/\/+$/, ''),
      apiKey: parts[5] || '',
      category: parts[6] || '',
      key: (parts[0] || url).replace(/[^\w.-]/g, '_'),
    })
  }
  return out
}

// 解析映射规则，长前缀在前
export function parsePathMap(settings) {
  const rules = []
  for (const line of String(settings.path_map || '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const m = s.split(/=>|->|\s{2,}/)
    if (m.length < 2) continue
    const from = m[0].trim().replace(/\/+$/, '')
    const to = m[1].trim().replace(/\/+$/, '')
    if (!from || !to) continue
    rules.push({ from, to })
  }
  return rules.sort((a, b) => b.from.length - a.from.length)
}

export function mapPath(source, settings, savePath, rules) {
  const path = String(savePath || '')
  const list = rules || parsePathMap(settings)
  for (const r of list) {
    if (path === r.from) return r.to
    if (path.startsWith(r.from + '/') || path.startsWith(r.from + '\\')) return r.to + path.slice(r.from.length)
  }
  // 没有命中规则时退回单前缀映射
  const from = String((source && source.pathFrom) || settings.path_from || '').trim().replace(/\/+$/, '')
  const to = String(settings.path_to || '').trim().replace(/\/+$/, '')
  if (!from || !to) return path
  if (path === from) return to
  if (path.startsWith(from + '/') || path.startsWith(from + '\\')) return to + path.slice(from.length)
  return path
}
