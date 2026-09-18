from decimal import Decimal, ROUND_HALF_UP


def r2(x) -> float:
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def compute_document(lines: list, company_state_code: str, pos_state_code: str,
                     is_export_sez: bool = False, lut_flag: bool = False,
                     reverse_charge: bool = False) -> dict:
    zero_rated = bool(reverse_charge) or (is_export_sez and lut_flag)
    intra = (pos_state_code == company_state_code) and not is_export_sez
    out_lines = []
    for l in lines:
        qty = float(l.get("qty", 1))
        rate = float(l.get("rate", 0))
        disc = float(l.get("discount", 0) or 0)
        taxable = r2(qty * rate - disc)
        tax_rate = 0.0 if zero_rated else float(l.get("tax_rate", 18))
        tax = r2(taxable * tax_rate / 100)
        if intra:
            cgst = r2(tax / 2)
            sgst = r2(tax - cgst)
            igst = 0.0
        else:
            cgst = sgst = 0.0
            igst = tax
        total = r2(taxable + cgst + sgst + igst)
        out_lines.append({
            "description": l.get("description", ""), "product_id": l.get("product_id"),
            "hsn_sac": l.get("hsn_sac", ""), "qty": qty, "unit": l.get("unit", "Nos"),
            "rate": rate, "discount": disc, "taxable": taxable, "tax_rate": tax_rate,
            "cgst": cgst, "sgst": sgst, "igst": igst, "total": total,
        })
    sub_total = r2(sum(l["qty"] * l["rate"] for l in out_lines))
    total_discount = r2(sum(l["discount"] for l in out_lines))
    total_taxable = r2(sum(l["taxable"] for l in out_lines))
    total_cgst = r2(sum(l["cgst"] for l in out_lines))
    total_sgst = r2(sum(l["sgst"] for l in out_lines))
    total_igst = r2(sum(l["igst"] for l in out_lines))
    total_tax = r2(total_cgst + total_sgst + total_igst)
    raw_total = r2(total_taxable + total_tax)
    grand = float(Decimal(str(raw_total)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    round_off = r2(grand - raw_total)
    return {
        "lines": out_lines,
        "sub_total": sub_total,
        "total_discount": total_discount,
        "total_taxable": total_taxable,
        "total_cgst": total_cgst,
        "total_sgst": total_sgst,
        "total_igst": total_igst,
        "total_tax": total_tax,
        "round_off": round_off,
        "grand_total": grand,
        "tax_scheme": "zero_rated" if zero_rated else ("intra_state" if intra else "inter_state"),
    }


def inr(n) -> str:
    n = float(n or 0)
    neg = n < 0
    n = abs(n)
    s = f"{n:.2f}"
    whole, frac = s.split(".")
    if len(whole) > 3:
        last3 = whole[-3:]
        rest = whole[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        whole = ",".join(parts) + "," + last3
    return ("-" if neg else "") + whole + "." + frac


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
         "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
         "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + " " + _ONES[n % 10]).strip()


def _three(n: int) -> str:
    h, rem = n // 100, n % 100
    out = ""
    if h:
        out += _ONES[h] + " Hundred"
    if rem:
        out += (" " if out else "") + _two(rem)
    return out


def in_words(amount) -> str:
    n = int(round(float(amount or 0)))
    if n == 0:
        return "Rupees Zero Only"
    crore, rem = n // 10000000, n % 10000000
    lakh, rem = rem // 100000, rem % 100000
    thousand, hundred = rem // 1000, rem % 1000
    parts = []
    if crore:
        parts.append(_three(crore) + " Crore")
    if lakh:
        parts.append(_two(lakh) + " Lakh")
    if thousand:
        parts.append(_two(thousand) + " Thousand")
    if hundred:
        parts.append(_three(hundred))
    return "Rupees " + " ".join(parts) + " Only"
