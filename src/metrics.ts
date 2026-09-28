import { getSessionCount } from './session.js'

/**
 * 进程级计数器：只统计自进程启动以来的累加值，重启后归零。
 * 不引入任何监控依赖，直接按 Prometheus 文本格式（version=0.0.4）输出。
 */
let httpRequestsTotal = 0
let chatMessagesTotal = 0

/** 记录一次 HTTP 请求（在全局中间件中调用）。 */
export function recordHttpRequest(): void {
  httpRequestsTotal++
}

/** 记录一次已转发的聊天消息。 */
export function recordChatMessage(): void {
  chatMessagesTotal++
}

/** 重置计数器，供测试隔离使用。 */
export function resetMetrics(): void {
  httpRequestsTotal = 0
  chatMessagesTotal = 0
}

interface MetricLine {
  name: string
  help: string
  type: 'counter' | 'gauge'
  value: number
}

/**
 * 渲染 Prometheus 文本格式指标。
 * 只暴露可廉价获得的真实数值，不编造数据。
 */
export function renderMetrics(): string {
  const memory = process.memoryUsage()
  const metrics: MetricLine[] = [
    {
      name: 'process_uptime_seconds',
      help: 'Node.js 进程运行时长（秒）',
      type: 'gauge',
      value: process.uptime(),
    },
    {
      name: 'process_resident_memory_bytes',
      help: 'Node.js 进程常驻内存大小（字节）',
      type: 'gauge',
      value: memory.rss,
    },
    {
      name: 'nodejs_heap_used_bytes',
      help: 'V8 堆已使用字节数',
      type: 'gauge',
      value: memory.heapUsed,
    },
    {
      name: 'nodejs_heap_total_bytes',
      help: 'V8 堆申请的总字节数',
      type: 'gauge',
      value: memory.heapTotal,
    },
    {
      name: 'unciv_http_requests_total',
      help: '自进程启动以来处理的 HTTP 请求总数',
      type: 'counter',
      value: httpRequestsTotal,
    },
    {
      name: 'unciv_active_sessions',
      help: '当前未过期的后台会话数量',
      type: 'gauge',
      value: getSessionCount(),
    },
    {
      name: 'unciv_chat_messages_total',
      help: '自进程启动以来转发的聊天消息总数',
      type: 'counter',
      value: chatMessagesTotal,
    },
  ]

  const lines: string[] = []
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`)
    lines.push(`# TYPE ${metric.name} ${metric.type}`)
    lines.push(`${metric.name} ${metric.value}`)
  }
  return `${lines.join('\n')}\n`
}
