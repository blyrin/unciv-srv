export default defineNitroConfig({
  compatibilityDate: '2025-07-01',
  experimental: {
    tasks: true,
    websocket: true,
  },
  scheduledTasks: {
    '* 4 * * *': ['cleanup'],
  },
  rollupConfig: {
    output: {
      compact: true,
    },
  },
})
