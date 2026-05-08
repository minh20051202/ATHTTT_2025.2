import { api } from './api.js'

export const attacksApi = {
  replay: (data) => api.post('/attacks/replay', data),
  tokenTheft: (data) => api.post('/attacks/token-theft', data),
  credentialStuffing: (data) => api.post('/attacks/credential-stuffing', data),
}