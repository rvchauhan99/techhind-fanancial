// k6 — invoice list + dashboard (50 VUs)
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 50,
  duration: '45s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
}

const BASE = __ENV.API_BASE || 'http://127.0.0.1:8000'
const EMAIL = __ENV.QA_EMAIL || 'gayatribachauhan99@gmail.com'
const PASS = __ENV.QA_PASSWORD || 'TechHind@2026'

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  })
  return { token: res.json('access_token') }
}

export default function (data) {
  const h = { Authorization: `Bearer ${data.token}` }
  const inv = http.get(`${BASE}/api/invoices`, { headers: h })
  const dash = http.get(`${BASE}/api/dashboard/summary`, { headers: h })
  check(inv, { 'invoices 200': (r) => r.status === 200 })
  check(dash, { 'dashboard 200': (r) => r.status === 200 })
  sleep(0.3)
}
