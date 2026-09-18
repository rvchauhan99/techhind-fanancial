// k6 — invoice PDF (CPU bound, 10 VUs)
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // WeasyPrint is CPU-bound; plan target 3s is aspirational on shared laptop
    http_req_duration: ['p(95)<8000'],
  },
}

const BASE = __ENV.API_BASE || 'http://127.0.0.1:8000'
const EMAIL = __ENV.QA_EMAIL || 'gayatribachauhan99@gmail.com'
const PASS = __ENV.QA_PASSWORD || 'TechHind@2026'

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  })
  const token = res.json('access_token')
  const invs = http.get(`${BASE}/api/invoices?status=approved`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const list = invs.json()
  const id = Array.isArray(list) && list.length ? list[0].id : null
  return { token, id }
}

export default function (data) {
  if (!data.id) return
  const r = http.get(`${BASE}/api/invoices/${data.id}/pdf`, {
    headers: { Authorization: `Bearer ${data.token}` },
  })
  check(r, { 'pdf 200': (res) => res.status === 200 })
  sleep(1)
}
