import { createClient } from 'npm:@redis/client'

export const cache = createClient({
  url: Deno.env.get('REDIS_URL') || 'redis://localhost:6379',
})
