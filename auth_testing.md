# Auth Testing Playbook (TCF)

## Credentials

Do **not** store passwords in this file. Use gitignored `memory/test_credentials.md` (create locally if missing).

## MongoDB verification

```
mongosh
use <DB_NAME from backend/.env>
db.users.find({role: "admin"})
db.users.findOne({role: "admin"}, {password_hash: 1})   # bcrypt hash starts $2b$
db.users.getIndexes()                                    # unique index on email
```

## API testing (local)

```
API=http://127.0.0.1:8000
# Load email/password from memory/test_credentials.md
curl -c cookies.txt -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<admin_email>","password":"<password>"}'
# → {requires_2fa:false, user:{...}, access_token:"..."} + cookies
curl -b cookies.txt $API/api/auth/me
```

## 2FA

POST `/api/auth/2fa/setup` (Bearer) → `{secret, provisioning_uri}`  
POST `/api/auth/2fa/enable` `{"otp":"..."}`  
Login then returns `{"requires_2fa": true}` until otp supplied.

## RBAC matrix (negative tests)

- viewer POST `/api/invoices` → 403
- ops POST `/api/invoices/{id}/approve` → 403
- accountant PUT `/api/settings/company` → 403
- viewer GET `/api/dashboard/summary` → 200 (read-only allowed)
