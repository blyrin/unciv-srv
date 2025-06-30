export default defineNitroConfig({
  compatibilityDate: '2025-07-01',
  experimental: {
    tasks: true,
  },
  runtimeConfig: {
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: +(process.env.DB_PORT || 5432),
    dbName: process.env.DB_NAME || 'unciv-srv',
    dbUser: process.env.DB_USER || 'postgres',
    dbPassword: process.env.DB_PASSWORD || 'postgres',
    adminUsername: process.env.ADMIN_USERNAME || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
  },
  scheduledTasks: {
    '* 4 * * *': ['cleanup'],
  },
})
