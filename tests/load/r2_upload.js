// k6 — R2 branding upload (5 VUs)
import http from 'k6/http'
import { check, sleep } from 'k6'
import encoding from 'k6/encoding'

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // R2 round-trip from local; plan target 2s is aspirational under concurrent uploads
    http_req_duration: ['p(95)<8000'],
  },
}

const BASE = __ENV.API_BASE || 'http://127.0.0.1:8000'
const EMAIL = __ENV.QA_EMAIL || 'gayatribachauhan99@gmail.com'
const PASS = __ENV.QA_PASSWORD || 'TechHind@2026'

// 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  })
  return { token: res.json('access_token') }
}

export default function (data) {
  const bin = encoding.b64decode(PNG_B64)
  const fd = {
    file: http.file(bin, 'pixel.png', 'image/png'),
  }
  const r = http.post(`${BASE}/api/settings/company/assets/logo`, fd, {
    headers: { Authorization: `Bearer ${data.token}` },
  })
  check(r, { 'upload 200': (res) => res.status === 200 })
  sleep(1)
}
