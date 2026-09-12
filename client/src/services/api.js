import axios from 'axios'

// Amplify builds inject the API Gateway URL, including the /api suffix.
// Relative /api also supports Docker and the local Vite proxy.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
})

export default api
