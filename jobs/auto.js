import { run as transferRun } from './transfer.js'

// 定时自动转移：只在「正式执行」且「开启自动」时动手，避免误跑。
export async function run(ctx) {
  const settings = await ctx.settings.get()
  if (settings.auto_enabled !== true) return { skipped: '自动转移未开启' }
  if (settings.dry_run !== false) return { skipped: '当前为试运行模式，自动任务不做实际转移' }

  const summary = await transferRun(ctx, { all: false })
  const line = `加入 ${summary.added}，跳过 ${summary.skipped}，失败 ${summary.failed}` +
    (summary.rolled_back ? `，回滚 ${summary.rolled_back}` : '') +
    (summary.removed_from_qb ? `，清理源任务 ${summary.removed_from_qb}` : '')

  if (settings.notify_enabled !== false && (summary.added || summary.failed)) {
    try {
      await ctx.notify({
        title: 'QB → TR 自动转移',
        body: line,
        level: summary.failed ? 'warning' : 'success',
        dedupe_key: 'qb2tr:auto:' + new Date().toISOString().slice(0, 13),
      })
    } catch (error) {
      await ctx.task.log('通知发送失败：' + ((error && error.message) || error))
    }
  }
  await ctx.task.log(line)
  return { added: summary.added, failed: summary.failed, skipped: summary.skipped }
}

export async function recover() {
  return { action: 'resume' }
}
