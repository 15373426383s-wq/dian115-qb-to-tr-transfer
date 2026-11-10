// 页面：qB → TR 转移做种。视觉走玻璃拟态 + 流水线状态，数据全部 textContent 渲染。
export async function mount(root, ctx) {
  const doc = root.ownerDocument
  const wrap = doc.createElement('section')
  wrap.className = 'qb2tr'
  const style = doc.createElement('style')
  style.textContent = `
.qb2tr{
  --ink:var(--app-text,#e8ecf5); --dim:color-mix(in srgb,var(--app-text,#e8ecf5) 62%,transparent);
  --line:color-mix(in srgb,var(--app-text,#e8ecf5) 14%,transparent);
  --card:color-mix(in srgb,var(--app-surface,#12161f) 88%,var(--app-text,#e8ecf5) 12%);
  --accent:var(--app-accent,#4f7cff); --ok:#2fbf71; --warn:#f0a93b; --bad:#ef5b6a; --idle:#8b93a7;
  position:relative; max-width:1180px; margin:0 auto; padding:22px;
  border-radius:18px; color:var(--ink);
  background:
    radial-gradient(1200px 380px at 12% -10%, color-mix(in srgb,var(--accent) 26%,transparent), transparent 62%),
    radial-gradient(900px 320px at 92% 0%, color-mix(in srgb,#7b5cff 20%,transparent), transparent 60%),
    linear-gradient(180deg, color-mix(in srgb,var(--card) 92%,transparent), transparent 42%);
  border:1px solid var(--line);
  box-shadow:0 24px 60px -32px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.06);
  font-variant-numeric:tabular-nums;
}
.qb2tr *{box-sizing:border-box}
.qb2tr h2{margin:0;font-size:21px;letter-spacing:.2px;display:flex;align-items:center;gap:10px}
.qb2tr .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 22%,transparent);animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.qb2tr .sub{margin:8px 0 0;color:var(--dim);font-size:13px;line-height:1.7;max-width:74ch}
.qb2tr .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 70%,transparent);color:var(--dim)}
.qb2tr .pill b{color:var(--ink);font-weight:600}
.qb2tr .hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}
.qb2tr .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 6px}
.qb2tr .kpi{position:relative;overflow:hidden;padding:14px 16px;border-radius:14px;border:1px solid var(--line);
  background:linear-gradient(160deg,color-mix(in srgb,var(--card) 96%,transparent),color-mix(in srgb,var(--card) 62%,transparent));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.qb2tr .kpi::after{content:"";position:absolute;inset:auto -30% -60% -30%;height:120px;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 30%,transparent),transparent);opacity:.5;pointer-events:none}
.qb2tr .kpi .k{font-size:12px;color:var(--dim);letter-spacing:.4px;text-transform:uppercase}
.qb2tr .kpi .v{font-size:26px;font-weight:700;margin-top:6px;line-height:1.1}
.qb2tr .kpi .u{font-size:12px;color:var(--dim);margin-left:4px;font-weight:400}
.qb2tr .bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0 4px}
.qb2tr button{font:inherit;color:var(--ink);background:color-mix(in srgb,var(--card) 88%,transparent);
  border:1px solid var(--line);border-radius:11px;padding:10px 15px;min-height:40px;cursor:pointer;
  transition:transform .12s ease,box-shadow .15s ease,border-color .15s ease,background .15s ease}
.qb2tr button:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 12px 26px -18px var(--accent)}
.qb2tr button:active:not(:disabled){transform:translateY(0)}
.qb2tr button:disabled{opacity:.45;cursor:not-allowed}
.qb2tr button.primary{background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#8b5cf6));border-color:transparent;color:#fff;
  box-shadow:0 14px 30px -18px var(--accent)}
.qb2tr button.ghost{background:transparent}
.qb2tr .spacer{flex:1 1 auto}
.qb2tr .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
@media (max-width:760px){.qb2tr .steps{grid-template-columns:repeat(2,1fr)}}
.qb2tr .step{position:relative;padding:10px 12px 10px 34px;border-radius:12px;border:1px dashed var(--line);color:var(--dim);font-size:13px}
.qb2tr .step i{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;border-radius:50%;
  border:2px solid color-mix(in srgb,var(--dim) 60%,transparent);display:grid;place-items:center;font-style:normal;font-size:10px}
.qb2tr .step.on{border-style:solid;border-color:color-mix(in srgb,var(--accent) 50%,var(--line));color:var(--ink);
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
.qb2tr .step.on i{border-color:var(--accent);background:var(--accent);color:#fff}
.qb2tr .panel{margin-top:14px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:color-mix(in srgb,var(--card) 72%,transparent)}
.qb2tr .panel-h{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--dim)}
.qb2tr .panel-h b{color:var(--ink);font-weight:600;font-size:13px}
.qb2tr table{width:100%;border-collapse:collapse;font-size:13px}
.qb2tr thead th{position:sticky;top:0;backdrop-filter:blur(8px);background:color-mix(in srgb,var(--card) 88%,transparent);
  text-align:left;font-weight:500;color:var(--dim);padding:10px;border-bottom:1px solid var(--line);font-size:12px;letter-spacing:.3px}
.qb2tr tbody tr{transition:background .15s ease}
.qb2tr tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
.qb2tr td{padding:10px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent);vertical-align:middle}
.qb2tr td.name{max-width:430px}
.qb2tr td.name .n{overflow-wrap:anywhere;line-height:1.45}
.qb2tr td.name .h{color:var(--dim);font-size:11px;margin-top:3px;font-family:ui-monospace,Consolas,monospace}
.qb2tr .tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid var(--line);color:var(--dim)}
.qb2tr .tag.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 12%,transparent)}
.qb2tr .tag.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.qb2tr .tag.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,transparent);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.qb2tr .tag.acc{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.qb2tr .meter{position:relative;height:6px;border-radius:999px;background:color-mix(in srgb,var(--ink) 12%,transparent);overflow:hidden;min-width:70px}
.qb2tr .meter span{position:absolute;inset:0 auto 0 0;border-radius:999px;background:linear-gradient(90deg,var(--accent),#8b5cf6)}
.qb2tr .path{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dim);overflow-wrap:anywhere}
.qb2tr .empty{padding:44px 18px;text-align:center;color:var(--dim)}
.qb2tr .empty .big{font-size:34px;opacity:.5;margin-bottom:10px}
.qb2tr .log{margin-top:14px;border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:color-mix(in srgb,var(--card) 62%,transparent);font-size:12.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;max-height:34vh;overflow:auto;color:var(--dim)}
.qb2tr .log b{color:var(--ink)}
.qb2tr .banner{display:flex;gap:10px;align-items:center;margin-top:14px;padding:10px 14px;border-radius:12px;font-size:12.5px;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:color-mix(in srgb,var(--warn) 12%,transparent);color:color-mix(in srgb,var(--warn) 88%,var(--ink))}
.qb2tr .spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--ink) 30%,transparent);border-top-color:var(--accent);animation:sp .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
.qb2tr .fade{animation:fade .25s ease both}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.qb2tr .chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.qb2tr .chip{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;font-size:12px;
  border:1px solid var(--line);background:color-mix(in srgb,var(--card) 78%,transparent);color:var(--dim)}
.qb2tr .chip b{color:var(--ink);font-weight:600}
.qb2tr .chip .n{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:11px;
  background:linear-gradient(135deg,var(--accent),#8b5cf6);color:#fff}`
  wrap.append(style)

  // ---- 头图 ----
  const hero = doc.createElement('div')
  hero.className = 'hero'
  const left = doc.createElement('div')
  const h = doc.createElement('h2')
  const dot = doc.createElement('span'); dot.className = 'dot'
  h.append(dot, doc.createTextNode('qBittorrent → Transmission 转移做种'))
  const sub = doc.createElement('p')
  sub.className = 'sub'
  sub.textContent = '导出 qB 已完成种子 → 按路径映射加入 TR（先暂停）→ 强制校验本地数据 → 目录二次确认 → 开始做种 → 才允许从 qB 移除任务（永不删数据）。任何一步不通过都会回滚 TR 任务，qB 原样保留。'
  left.append(h, sub)
  const right = doc.createElement('div')
  right.className = 'bar'
  const pillDry = doc.createElement('span'); pillDry.className = 'pill'
  const pillLast = doc.createElement('span'); pillLast.className = 'pill'
  right.append(pillDry, pillLast)
  hero.append(left, right)
  wrap.append(hero)

  const banner = doc.createElement('div')
  banner.className = 'banner'
  banner.hidden = true
  wrap.append(banner)

  // ---- KPI ----
  const kpis = doc.createElement('div')
  kpis.className = 'kpis'
  const mk = (k, u) => {
    const box = doc.createElement('div'); box.className = 'kpi'
    const kk = doc.createElement('div'); kk.className = 'k'; kk.textContent = k
    const vv = doc.createElement('div'); vv.className = 'v'; vv.textContent = '—'
    if (u) { const uu = doc.createElement('span'); uu.className = 'u'; uu.textContent = u; vv.append(uu) }
    box.append(kk, vv); kpis.append(box)
    return vv
  }
  const kQb = mk('qB 已完成', '个')
  const kTr = mk('TR 已有', '个')
  const kPend = mk('待转移', '个')
  const kDone = mk('上次成功', '个')
  wrap.append(kpis)

  const chips = doc.createElement('div')
  chips.className = 'chips'
  wrap.append(chips)

  // ---- 操作 ----
  const bar = doc.createElement('div')
  bar.className = 'bar'
  const btnScan = doc.createElement('button'); btnScan.className = 'primary'; btnScan.textContent = '扫描 qB 已完成种子'
  const btnAll = doc.createElement('button'); btnAll.textContent = '一键转移待处理'
  const btnPick = doc.createElement('button'); btnPick.textContent = '转移选中'; btnPick.disabled = true
  const btnCross = doc.createElement('button'); btnCross.textContent = 'TR 辅种'
  const btnAutoSeed = doc.createElement('button'); btnAutoSeed.textContent = '自动辅种'
  const spacer = doc.createElement('span'); spacer.className = 'spacer'
  const btnReload = doc.createElement('button'); btnReload.className = 'ghost'; btnReload.textContent = '刷新'
  bar.append(btnScan, btnAll, btnPick, btnCross, btnAutoSeed, spacer, btnReload)
  wrap.append(bar)

  // ---- 流水线 ----
  const steps = doc.createElement('div')
  steps.className = 'steps'
  const stepDefs = [['导出种子', '↑'], ['加入 TR（暂停）', '⊕'], ['校验本地数据', '✓'], ['做种 / 清理源', '∞']]
  for (const [label, glyph] of stepDefs) {
    const s = doc.createElement('div'); s.className = 'step'
    const i = doc.createElement('i'); i.textContent = glyph
    const t = doc.createElement('span'); t.textContent = label
    s.append(i, t); steps.append(s)
  }
  wrap.append(steps)

  // ---- 表格 ----
  const panel = doc.createElement('div'); panel.className = 'panel'
  const ph = doc.createElement('div'); ph.className = 'panel-h'
  const phb = doc.createElement('b'); phb.textContent = '待转移清单'
  const phc = doc.createElement('span'); phc.textContent = '勾选后点「转移选中」，或直接「一键转移待处理」'
  const phs = doc.createElement('span'); phs.className = 'spacer'
  ph.append(phb, phc, phs)
  panel.append(ph)

  const table = doc.createElement('table')
  const thead = doc.createElement('thead')
  const hr = doc.createElement('tr')
  const box = doc.createElement('input'); box.type = 'checkbox'; box.title = '全选可转移'
  const heads = ['', '名称 / 信息哈希', '来源', '大小', 'qB 状态', 'TR', '目标目录', '']
  heads.forEach((txt, idx) => {
    const th = doc.createElement('th')
    if (idx === 0) th.append(box); else th.textContent = txt
    hr.append(th)
  })
  thead.append(hr)
  const tbody = doc.createElement('tbody')
  table.append(thead, tbody)
  panel.append(table)
  wrap.append(panel)

  const log = doc.createElement('div'); log.className = 'log'; log.textContent = '尚未扫描。'
  wrap.append(log)

  // ---- 状态 ----
  let items = []
  const picked = new Set()
  let lastTransfer = null
  let pathStats = []

  const fmt = n => {
    const v = Number(n) || 0
    if (v >= 1024 ** 4) return (v / 1024 ** 4).toFixed(2) + ' TB'
    if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(2) + ' GB'
    if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(1) + ' MB'
    return Math.round(v / 1024) + ' KB'
  }
  const short = s => String(s || '').slice(0, 16) + (String(s || '').length > 16 ? '…' : '')

  // qBittorrent state → 中文
  const QB_STATE_CN = {
    error: '错误', missingFiles: '缺失文件',
    uploading: '上传中', stalledUP: '上传等待', queuedUP: '排队上传', checkingUP: '校验中', forcedUP: '强制上传',
    downloading: '下载中', metaDL: '获取元数据', stalledDL: '下载等待', queuedDL: '排队下载', checkingDL: '校验中', forcedDL: '强制下载',
    pausedUP: '已暂停·上传', pausedDL: '已暂停·下载',
    allocating: '分配空间', moving: '移动中', unknown: '未知',
  }
  const qbStateCn = s => QB_STATE_CN[s] || (s ? s : '未知')

  function setSteps(active) {
    Array.from(steps.children).forEach((el, i) => el.classList.toggle('on', i <= active))
  }

  function renderRow(it) {
    const tr = doc.createElement('tr')
    tr.className = 'fade'

    const c0 = doc.createElement('td')
    const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = picked.has(it.hash); cb.disabled = it.in_tr
    cb.addEventListener('change', () => { cb.checked ? picked.add(it.hash) : picked.delete(it.hash) })
    c0.append(cb)

    const c1 = doc.createElement('td'); c1.className = 'name'
    const n = doc.createElement('div'); n.className = 'n'; n.textContent = it.name
    const hh = doc.createElement('div'); hh.className = 'h'; hh.textContent = it.hash
    c1.append(n, hh)

    const c1b = doc.createElement('td')
    const src = doc.createElement('span'); src.className = 'tag acc'; src.textContent = it.source || 'QB'
    c1b.append(src)

    const c2 = doc.createElement('td'); c2.textContent = fmt(it.size)

    const c3 = doc.createElement('td')
    const st = doc.createElement('span'); st.className = 'tag'
    st.textContent = qbStateCn(it.state)
    c3.append(st)

    const c4 = doc.createElement('td')
    if (it.in_tr) {
      const pct = it.tr_percent === null ? null : Math.round(Number(it.tr_percent) * 100)
      const t = doc.createElement('span'); t.className = 'tag ok'; t.textContent = pct === null ? '已有' : pct + '%'
      const m = doc.createElement('div'); m.className = 'meter'
      const sp = doc.createElement('span'); sp.style.width = (pct || 0) + '%'
      m.append(sp)
      c4.append(t, m)
    } else if (it.tr_dir_ok === false) {
      const t = doc.createElement('span'); t.className = 'tag bad'; t.textContent = '目录不可见'
      c4.append(t)
    } else {
      const t = doc.createElement('span'); t.className = 'tag acc'; t.textContent = '待加入'
      c4.append(t)
    }

    const c5 = doc.createElement('td'); c5.className = 'path'
    c5.textContent = it.target_dir || '（同 qB 路径）'

    const c6 = doc.createElement('td')
    const one = doc.createElement('button'); one.className = 'ghost'; one.textContent = '转移'
    one.disabled = it.in_tr
    one.addEventListener('click', () => transfer({ hashes: [it.hash] }, `正在转移「${it.name}」`))
    c6.append(one)

    tr.append(c0, c1, c1b, c2, c3, c4, c5, c6)
    return tr
  }

  function renderPathChips() {
    if (!pathStats.length) return
    for (const p of pathStats.slice(0, 12)) {
      const chip = doc.createElement('span'); chip.className = 'chip'
      const t = doc.createElement('b'); t.textContent = p.source
      const a = doc.createElement('span'); a.className = 'path'; a.textContent = p.path
      const arrow = doc.createElement('span'); arrow.textContent = '→'
      const b = doc.createElement('span'); b.className = 'path'
      b.textContent = p.mapped && p.mapped !== p.path ? p.mapped : '同路径'
      const c = doc.createElement('span'); c.textContent = `×${p.count}`
      chip.append(t, a, arrow, b, c)
      chips.append(chip)
    }
  }

  function renderChips() {
    chips.replaceChildren()
    const bySource = new Map()
    for (const it of items) {
      const k = it.source || 'QB'
      const cur = bySource.get(k) || { total: 0, pending: 0 }
      cur.total++
      if (!it.in_tr) cur.pending++
      bySource.set(k, cur)
    }
    if (!bySource.size) return
    let i = 0
    for (const [name, v] of bySource) {
      const chip = doc.createElement('span'); chip.className = 'chip'
      const n = doc.createElement('span'); n.className = 'n'; n.textContent = String(++i)
      const t = doc.createElement('b'); t.textContent = name
      const c = doc.createElement('span'); c.textContent = `${v.total} 个 · 待转 ${v.pending}`
      chip.append(n, t, c)
      chips.append(chip)
    }
  }

  function render() {
    tbody.replaceChildren()
    if (!items.length) {
      const tr = doc.createElement('tr')
      const td = doc.createElement('td'); td.colSpan = 8
      const em = doc.createElement('div'); em.className = 'empty'
      const big = doc.createElement('div'); big.className = 'big'; big.textContent = '⛁'
      const txt = doc.createElement('div'); txt.textContent = '还没有数据。点「扫描 qB 已完成种子」开始。'
      em.append(big, txt); td.append(em); tr.append(td); tbody.append(tr)
    } else {
      for (const it of items) tbody.append(renderRow(it))
    }
    const pending = items.filter(i => !i.in_tr).length
    btnPick.disabled = picked.size === 0
    btnPick.textContent = picked.size ? `转移选中（${picked.size}）` : '转移选中'
    btnAll.disabled = pending === 0
    kQb.textContent = items.length
    kTr.textContent = items.length - pending
    kPend.textContent = pending
    renderChips()
    renderPathChips()
  }

  async function load() {
    const scan = await ctx.storage.get('candidates')
    items = (scan && Array.isArray(scan.items)) ? scan.items : []
    pathStats = (scan && Array.isArray(scan.pathStats)) ? scan.pathStats : []
    lastTransfer = await ctx.storage.get('last_transfer')
    const settings = await ctx.settings.get()
    const dry = settings.dry_run !== false
    pillDry.textContent = ''
    const b1 = doc.createElement('b'); b1.textContent = dry ? '试运行' : '正式执行'
    pillDry.append('模式：', b1)
    pillDry.style.borderColor = dry ? 'color-mix(in srgb,var(--warn) 45%,transparent)' : 'color-mix(in srgb,var(--ok) 45%,transparent)'
    banner.hidden = !dry
    banner.textContent = dry
      ? '当前是试运行：只生成计划，不会真的加入 TR，也不会改动 qB。确认清单和目录映射无误后，到插件设置里关掉「试运行」。'
      : '正式执行模式：会真的加入 TR；只有校验通过并确认做种后，才按设置决定是否清理 qB（清理也不删数据）。'
    if (banner.hidden) banner.style.display = 'none'; else banner.style.display = ''
    if (lastTransfer) {
      pillLast.textContent = ''
      const b2 = doc.createElement('b'); b2.textContent = `${lastTransfer.added || 0} 加入 / ${lastTransfer.failed || 0} 失败`
      pillLast.append('上次：', b2)
      kDone.textContent = lastTransfer.added || 0
    }
    if (scan && Array.isArray(scan.failed) && scan.failed.length) {
      banner.hidden = false
      banner.style.display = ''
      banner.textContent = '以下实例读取失败：' + scan.failed.map(f => `${f.source}（${f.error}）`).join('；')
    }
    render()
  }

  function pollStorage(key, since) {
    return new Promise(resolve => {
      const timer = setInterval(async () => {
        try {
          const v = await ctx.storage.get(key)
          if (v && v.at && Date.parse(v.at) >= since - 2000) { clearInterval(timer); resolve(v) }
        } catch { clearInterval(timer); resolve(null) }
      }, 900)
      setTimeout(() => { clearInterval(timer); resolve(null) }, 15 * 60 * 1000)
    })
  }

  async function runJob(id, input, label, key) {
    btnScan.disabled = btnAll.disabled = btnPick.disabled = true
    log.textContent = ''
    const sp = doc.createElement('span'); sp.className = 'spin'
    log.append(sp, doc.createTextNode(label + '…'))
    setSteps(0)
    const since = Date.now()
    try {
      await ctx.tasks.run(id, 'u' + since, input || {})
      const done = await pollStorage(key, since)
      setSteps(3)
      return done
    } finally {
      btnScan.disabled = false
      render()
    }
  }

  btnScan.addEventListener('click', async () => {
    try {
      await runJob('scan', {}, '正在扫描 qB 与 TR', 'candidates')
      await load()
      log.textContent = items.length
        ? `扫描完成：qB 已完成 ${items.length} 个，TR 已有 ${items.filter(i => i.in_tr).length} 个，待转移 ${items.filter(i => !i.in_tr).length} 个。`
        : '扫描完成：没有已完成的种子。'
    } catch (e) {
      log.textContent = '扫描失败：' + ((e && e.message) || e)
    }
  })

  async function transfer(input, label) {
    const dry = (await ctx.settings.get()).dry_run !== false
    try {
      const last = await runJob('transfer', input, label, 'last_transfer')
      await load()
      const lines = []
      lines.push(`${dry ? '（试运行）' : ''}加入 ${last?.added || 0} · 跳过 ${last?.skipped || 0} · 失败 ${last?.failed || 0} · 回滚 ${last?.rolled_back || 0} · 清理源 ${last?.removed_from_qb || 0}`)
      for (const x of (last?.items || []).slice(0, 60)) {
        const mark = x.action === 'added' ? '✔' : x.action === 'fail' ? '✘' : x.action === 'plan' ? '›' : '·'
        lines.push(`${mark} ${x.name}${x.note ? ' — ' + x.note : ''}`)
      }
      log.textContent = lines.join('\n')
    } catch (e) {
      log.textContent = '转移失败：' + ((e && e.message) || e)
    }
  }

  btnAll.addEventListener('click', () => transfer({ all: true }, '正在转移全部待处理'))
  btnPick.addEventListener('click', () => transfer({ hashes: Array.from(picked) }, '正在转移选中'))
  btnReload.addEventListener('click', async () => { await load(); log.textContent = '已刷新。' })

  btnCross.addEventListener('click', async () => {
    btnCross.disabled = true
    log.textContent = ''
    const sp = doc.createElement('span'); sp.className = 'spin'
    log.append(sp, doc.createTextNode('正在扫描辅种目录并加入 TR…'))
    const since = Date.now()
    try {
      await ctx.tasks.run('crossseed', 'cross_' + since, {})
      const timer = setInterval(async () => {
        try {
          const v = await ctx.storage.get('last_crossseed')
          if (v && v.at && Date.parse(v.at) >= since - 2000) {
            clearInterval(timer)
            const lines = [`辅种完成：加入 ${v.added || 0} · 跳过 ${v.skipped || 0} · 失败 ${v.failed || 0} · 回滚 ${v.rolled_back || 0}${v.dry_run ? '（试运行）' : ''}`]
            for (const x of (v.items || [])) lines.push(`${x.action === 'added' ? '✔' : x.action === 'fail' ? '✘' : x.action === 'plan' ? '›' : '·'} ${x.name}${x.note ? ' — ' + x.note : ''}`)
            log.textContent = lines.join('\n')
          }
        } catch { clearInterval(timer); log.textContent = '辅种任务状态读取失败' }
      }, 1000)
    } catch (e) {
      log.textContent = '辅种启动失败：' + ((e && e.message) || e)
    } finally {
      btnCross.disabled = false
    }
  })
  box.addEventListener('change', () => {
    picked.clear()
    if (box.checked) for (const it of items) if (!it.in_tr) picked.add(it.hash)
    render()
  })

  btnAutoSeed.addEventListener('click', async () => {
    btnAutoSeed.disabled = true
    log.textContent = ''
    const sp = doc.createElement('span'); sp.className = 'spin'
    log.append(sp, doc.createTextNode('正在从 TR 提取做种并搜索 PT 站…'))
    const since = Date.now()
    const timer = setInterval(async () => {
      try {
        const v = await ctx.storage.get('last_autoseed')
        if (v && v.at && Date.parse(v.at) >= since - 2000) {
          clearInterval(timer)
          const lines = [`自动辅种：扫描 ${v.scanned || 0} · 匹配 ${v.matched || 0} · 推送 ${v.submitted || 0} · 跳过 ${v.skipped || 0} · 失败 ${v.failed || 0}${v.dry_run ? '（试运行）' : ''}${v.stopped ? ' · ' + v.stopped : ''}`]
          for (const x of (v.items || []).slice(0, 80)) {
            if (x.note) lines.push(`${x.note.includes('试运行') || x.note.includes('可辅') ? '›' : x.note.includes('失败') ? '✘' : '·'} ${x.name} — ${x.note}`)
          }
          log.textContent = lines.join('\n')
        }
      } catch { clearInterval(timer); log.textContent = '自动辅种状态读取失败' }
    }, 1200)
    try {
      await ctx.tasks.run('autoseed', 'auto_' + since, {})
    } catch (e) {
      clearInterval(timer)
      log.textContent = '自动辅种启动失败：' + ((e && e.message) || e)
      btnAutoSeed.disabled = false
    }
    // 任务结束后恢复按钮（最长 30 分钟）
    setTimeout(() => { btnAutoSeed.disabled = false }, 30 * 60 * 1000)
  })

  await load()
  root.append(wrap)
  return () => wrap.remove()
}
