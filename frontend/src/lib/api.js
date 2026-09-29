import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API_CONFIG_ERROR = !BACKEND_URL;
export const API = API_CONFIG_ERROR ? "" : `${BACKEND_URL}/api`;

const TOKEN_KEY = "tcf_token";
let token = localStorage.getItem(TOKEN_KEY);

export const getToken = () => token;
export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

function redirectToLogin() {
  setToken(null);
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

function skipsTokenRefresh(url) {
  const u = String(url || "");
  return u.includes("/auth/login") || u.includes("/auth/refresh");
}

const api = axios.create({
  baseURL: API || undefined,
  withCredentials: true,
  timeout: 15000,
});

api.interceptors.request.use((cfg) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const offline = new Error("You are offline. Finance actions need a connection.");
    offline.code = "OFFLINE";
    return Promise.reject(offline);
  }
  if (API_CONFIG_ERROR) {
    return Promise.reject(new Error("REACT_APP_BACKEND_URL is not configured"));
  }
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let refreshing = null;

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config || {};
    const status = err.response?.status;

    if (status !== 401 || orig._retried || skipsTokenRefresh(orig.url)) {
      return Promise.reject(err);
    }

    orig._retried = true;
    let access = null;
    try {
      refreshing =
        refreshing ||
        axios.post(`${API}/auth/refresh`, {}, { withCredentials: true, timeout: 15000 });
      const r = await refreshing;
      refreshing = null;
      access = r.data?.access_token || null;
    } catch (e) {
      refreshing = null;
      redirectToLogin();
      return Promise.reject(e);
    }

    if (!access) {
      redirectToLogin();
      return Promise.reject(err);
    }

    setToken(access);
    orig.headers = { ...(orig.headers || {}), Authorization: `Bearer ${access}` };
    try {
      return await axios(orig);
    } catch (e) {
      if (e?.response?.status === 401) redirectToLogin();
      return Promise.reject(e);
    }
  }
);

export function apiError(e) {
  if (API_CONFIG_ERROR) return "API URL is not configured (REACT_APP_BACKEND_URL)";
  if (e?.code === "OFFLINE") return e.message;
  if (e?.code === "ECONNABORTED") return "Request timed out — check API connectivity";
  if (!e?.response && e?.message) return e.message;
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
