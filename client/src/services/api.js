import axios from "axios";
import { getToken, saveToken, clearToken } from "./session";

const unauthorizedListeners = new Set();
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

// Amplify builds inject the API Gateway URL, including the /api suffix.
// Relative /api also supports Docker and the local Vite proxy.
const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, ""),
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (config.url === "/auth/logout") clearToken();
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => {
    if (response.config.url === "/auth/login") saveToken(response.data.token);
    return response;
  },
  (error) => {
    error.status = error.response?.status;
    error.message = error.response?.data?.error || error.message;
    if (error.status === 401) {
      clearToken();
      unauthorizedListeners.forEach((listener) => listener());
    }
    return Promise.reject(error);
  },
);

export default api;

export async function request(url, { body, ...options } = {}) {
  const response = await api.request({
    ...options,
    url: url.replace(/^\/api(?=\/|$)/, ""),
    ...(body === undefined ? {} : { data: JSON.parse(body) }),
  });
  return response.data;
}
