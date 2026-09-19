# Production cutover pack (local only — gitignored except this README)

Place source files here (not committed):

| File | Purpose |
|------|---------|
| `ved.xlsx` | Client codes + subscription start/end/type |
| `Account Internal(bank txn).csv` | HDFC statement (Date, Narration, Chq./Ref.No., D, Withdrawal, Deposit, Closing) |
| `Account Internal(expance).csv` | Travel / server expenses |
| `Account Internal(TDS).csv` | Historical TDS by company |

## Bootstrap + import

```bash
cd backend
source .venv/bin/activate

# Required env (in .env or export):
#   MONGO_URL or MONGO_URI
#   DB_NAME or MONGO_DATABASE
#   ALLOW_PROD_BOOTSTRAP=1
#   PROD_ADMIN_PASSWORD=<strong password>
#   PROD_ADMIN_EMAIL=ravat@techhind.in                  # optional
#   PROD_ADMIN_NAME=Ravatrajsinh Chauhan                # optional

python -m scripts.prod_bootstrap
# If DB was previously demo-seeded:
# python -m scripts.prod_bootstrap --purge-demo

python -m scripts.cutover_import --dry-run
python -m scripts.cutover_import --commit
```

After commit, HDFC live balance should equal last statement Closing (₹2,09,174.04).

Do **not** run `make seed-qa` against production.
