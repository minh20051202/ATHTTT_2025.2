import { api } from './api.js'

// Seed endpoint is safe to call multiple times — idempotent
// Returns existing user/agents if already seeded
export const demoApi = {
  seed: () => api.post('/demo/seed'),
}