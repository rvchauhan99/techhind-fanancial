# GST invariants — Critical tier

Money / GST / period / RBAC changes require **Critical** verification.

## Tax split

- Same place of supply as company state → **CGST + SGST**
- Different state → **IGST**
- Support LUT / RCM / zero-rated / SEZ flags where implemented
- Round-off line allowed; amounts in INR with Indian grouping in UI

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
