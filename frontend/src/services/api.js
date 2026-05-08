import axios from 'axios'

// Vite proxy handles /api → localhost:8000/api in development
// In production: set VITE_API_BASE_URL env var
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

export const api = axios.create({ baseURL })

// Normalize all errors to plain Error with human-readable message
api.interceptors.response.use(
  response => response,
  error => {
    const message =
      error.response?.data?.detail?.message ||
      error.response?.data?.detail ||
      error.message
    return Promise.reject(new Error(message))
  },
)