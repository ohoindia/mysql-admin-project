import axios from 'axios'

// In Docker/AWS the frontend and FastAPI are served from the same host,
// so /api is the production default. For local Vite development you can
// override it with VITE_API_URL=http://localhost:8000/api.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api'
})

export default api
