# GST invariants — Critical tier

Money / GST / period / RBAC changes require **Critical** verification.

## Tax split

- Same place of supply as **Settings company** `state_code` → **CGST + SGST**
- Different state (customer / invoice POS) → **IGST**
- Software/SaaS lines default **18%** (SAC 998314)
- Product/subscription `price_includes_gst`: line rate may be GST-inclusive; engine back-calculates exclusive via `exclusive_from_inclusive` before tax split
- Support LUT / RCM / zero-rated / SEZ flags where implemented
- Round-off line allowed; amounts in INR with Indian grouping in UI

## Catalog list prices (website parity)

- Monthly ₹14,999 excl; Quarterly ₹43,497 excl (₹14,499×3); Half-Year ₹83,994 excl (₹13,999×6) — all +18% GST
- Annual cutover SKU remains GST-**inclusive** client catalog (not website Yearly ₹12,999/mo list)

## CA accountant pack (`GET /accountant-pack?month=`)

ZIP for the month: `MANIFEST.txt`, sales/purchase/expense/receipts(+TDS)/vendor_payments/AR/AP CSVs, invoice PDFs (`pdfs/`), receipt PDFs (`receipts/`), expense voucher PDFs (`vouchers/`), voucher attachments, purchase bill PDFs (`bills/`). Caps via `ACCOUNTANT_PACK_MAX_PDFS` / `ACCOUNTANT_PACK_MAX_ATTACHMENTS`. Per-doc PDFs also on Expenses / Vendors / Payments / Invoices list. Bank cash book: `GET /banks/{id}/statement.csv`. Form 26Q / portal GSTR deferred.

## Subscriptions

- `POST /api/subscriptions/{id}/renew` may change plan/price (incl. GST) and create a draft renewal invoice
- Payment on a paid invoice with `subscription_id` advances `next_renewal_on`

## Numbering

- Format: `TH/{FY}/{SEQ}` (FY Apr–Mar)
- Assigned on **approve**, not on draft create
- Cancelled numbers are **not reused**

## Immutability

- After approve: invoice is locked (no silent field edits)
- Cancel is a distinct action; does not free the sequence

## Payments

- Allocation against invoice balance
- Optional TDS amount credits allocation
- Receipt PDF + receipt numbering
- Payment may advance subscription `next_renewal_on`
- Bank cash amount (not TDS) posts a **deposit** to `bank_ledger`; delete reverses the ledger line

## Bank ledger

- Live balance = opening + credits − debits (computed)
- Vendor payments and posted expense vouchers post **withdrawals**
- `method=cash` posts to the Cash account
- Period lock applies to ledger post / reverse / import / manual / transfer

## Credit / debit notes

- CN reduces remaining invoice balance
- DN increases payable/receivable as designed

## Period lock

- States: `open` → `in_review` → `gst_filed` → `closed`
- Closed period blocks financial mutations
- Only Admin reopens

## e-Invoice

- IRN/QR is **mock** until NIC credentials — do not claim live NIC compliance

## Verification

Run affected cases from `reference/case-catalog.md` and/or `tests/e2e_critical_api.py`.
