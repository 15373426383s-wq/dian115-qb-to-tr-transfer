// 定时任务（每 5 分钟）：转移新完成的种子（末尾自带 recheck 立即做种）→ 把 TR 里校验完成的启动做种。
import { run as transferRun } from './transfer.js'

export async function run(ctx) {
  const settings = await ctx.settings.get()
  if (settings.auto_enabled !== true) return { skipped: '自动转移未开启' }

  // 1) 转移 qB 已完成种子到 TR（加进去即删源，TR 自己校验）
  const t = await transferRun(ctx, { all: false })

  // 2) TR 里「校验完成且暂停」的启动做种（MoviePilot 的 check_recheck）
  const r = await transferRun(ctx, { recheck: true })

  const line = `转移 加入 ${t.added || 0} / 跳过 ${t.skipped || 0} / 失败 ${t.failed || 0} / 清源 ${t.removed_from_qb || 0}；做种启动 ${r.started || 0}`
  await ctx.task.log(line)

  if (settings.notify_enabled !== false && ((t.added || 0) + (r.started || 0) > 0 || (t.failed || 0) > 0)) {
    try {
      await ctx.notify({
        title: 'QB → TR 转移做种',
        body: line,
        level: (t.failed || 0) ? 'warning' : 'success',
        channels: ['telegram'],
        dedupe_key: 'qb2tr:auto:' + new Date().toISOString().slice(0, 13),
      })
    } catch (e) { await ctx.task.log('通知失败：' + ((e && e.message) || e)) }
  }
  return { added: t.added, failed: t.failed, started: r.started }
}

export async function recover() { return { action: 'resume' } }
