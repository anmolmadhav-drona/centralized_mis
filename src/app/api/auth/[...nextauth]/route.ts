// Auth.js route handlers — the single authentication entrypoint.
// Mounts every NextAuth action at /api/auth/* (signin, signout, csrf,
// session, callback/credentials, …).
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
