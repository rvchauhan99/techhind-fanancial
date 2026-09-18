// k6 — auth login smoke (20 VUs)
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Login is bcrypt-bound; list/dashboard scenarios use the tighter 500–800ms bar
    http_req_duration: ['p(95)<7000'],
  },
}

const BASE = __ENV.API_BASE || 'http://127.0.0.1:8000'
const EMAIL = __ENV.QA_EMAIL || 'gayatribachauhan99@gmail.com'
const PASS = __ENV.QA_PASSWORD || 'TechHind@2026'

export default function () {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  })
  check(res, { 'login 200': (r) => r.status === 200 })
  const token = res.json('access_token')
  if (token) {
    const me = http.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    check(me, { 'me 200': (r) => r.status === 200 })
  }
  sleep(0.5)
}
