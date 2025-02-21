import { type levellike, Logger } from '@libs/logger'

const env = Deno.env

const LOG_LEVEL = ['disabled', 'error', 'warn', 'info', 'log', 'debug']
    .includes(env.get('LOG_LEVEL') || '')
  ? env.get('LOG_LEVEL') as levellike
  : 'info'

export const log = new Logger({
  level: LOG_LEVEL,
  date: true,
  time: true,
  delta: false,
  caller: false,
})
