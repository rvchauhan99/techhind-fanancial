import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TOKEN_KEY = "tcf_token";
let token = localStorage.getItem(TOKEN_KEY);

export const getToken = () => token;
export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

const api = axios.create({ baseURL: API, withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let refreshing = null;

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config || {};
    if (err.response?.status === 401 && !orig._retried && !orig.url?.includes("/auth/")) {
      orig._retried = true;
      try {
        refreshing =
          refreshing ||
          axios.post(`${API}/auth/refresh`, {}, { withCredentials: true });
        const r = await refreshing;
        refreshing = null;
        setToken(r.data.access_token);
        orig.headers = { ...(orig.headers || {}), Authorization: `Bearer ${r.data.access_token}` };
        return axios(orig);
      } catch (e) {
        refreshing = null;
        setToken(null);
        if (window.location.pathname !== "/login") window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export function apiError(e) {
  const detail = e?.response?.data?.detail;
  if (detail == null) return e?.message || "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((x) => (x && typeof x.msg === "string" ? x.msg : JSON.stringify(x))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function pdfUrl(path) {
  return `${API}${path}${path.includes("?") ? "&" : "?"}auth=${token}`;
}

export default api;
