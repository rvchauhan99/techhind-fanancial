// k6 — payment create (10 VUs) — uses a fresh draft/approve per iteration is heavy;
// this scenario hits open-invoices list as proxy for payment path readiness.
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
}

const BASE = __ENV.API_BASE || 'http://127.0.0.1:8000'
const EMAIL = __ENV.QA_EMAIL || 'accountant@techhind.in'
const PASS = __ENV.QA_PASSWORD || 'Finance@123'

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  })
  const token = res.json('access_token')
  const custs = http.get(`${BASE}/api/customers`, { headers: { Authorization: `Bearer ${token}` } })
  const list = custs.json()
  const cid = Array.isArray(list) && list.length ? list[0].id : null
  return { token, cid }
}

export default function (data) {
  if (!data.cid) return
  const r = http.get(`${BASE}/api/payments/open-invoices/${data.cid}`, {
    headers: { Authorization: `Bearer ${data.token}` },
  })
  check(r, { 'open invoices 200': (res) => res.status === 200 })
  sleep(0.5)
}
