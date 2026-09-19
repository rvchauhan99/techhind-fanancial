import csv
import io
import zipfile
from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from core import db, require_roles, ALL_ROLES, get_company, audit, month_date_range
from gst import r2
import pdf as pdfmod

router = APIRouter(prefix="/api", tags=["reports"])


def _gstr_date(dstr: str) -> str:
    d = date.fromisoformat(dstr)
    return d.strftime("%d-%m-%Y")


def _month_docs(month: str):
    return {
        "invoice_date": month_date_range(month),
        "status": {"$nin": ["draft", "cancelled"]},
    }


@router.get("/reports/gstr1")
async def gstr1(month: str, user=Depends(require_roles(*ALL_ROLES))):
    company = await get_company()
    invs = await db.invoices.find(_month_docs(month), {"_id": 0}).sort("invoice_date", 1).to_list(5000)
    b2b_map, b2cs_map, cdnr_map = {}, {}, {}
    for inv in invs:
        items = []
        for i, l in enumerate(inv.get("lines", []), 1):
            items.append({"num": i, "itm_det": {"rt": l["tax_rate"], "txval": l["taxable"],
                                                "iamt": l["igst"], "camt": l["cgst"],
                                                "samt": l["sgst"], "csamt": 0}})
        entry = {"inum": inv["invoice_no"], "idt": _gstr_date(inv["invoice_date"]),
                 "val": inv["grand_total"], "pos": inv["place_of_supply"]["code"],
                 "rchrg": "Y" if inv.get("reverse_charge") else "N",
                 "inv_typ": "SEZWP" if inv.get("is_export_sez") else "R", "itms": items}
        gstin = (inv.get("customer_snapshot") or {}).get("gstin")
        if inv["doc_type"] in ("CN", "DN"):
            note = {"nt_num": inv["invoice_no"], "nt_dt": _gstr_date(inv["invoice_date"]),
                    "ntty": "C" if inv["doc_type"] == "CN" else "D",
                    "val": inv["grand_total"], "pos": inv["place_of_supply"]["code"], "itms": items}
            if gstin:
                cdnr_map.setdefault(gstin, {"ctin": gstin, "nt": []})["nt"].append(note)
            continue
        if gstin:
            b2b_map.setdefault(gstin, {"ctin": gstin, "inv": []})["inv"].append(entry)
        else:
            key = (entry["pos"], items[0]["itm_det"]["rt"] if items else 0)
            agg = b2cs_map.setdefault(key, {"sply_ty": "INTER" if entry["pos"] != company["state_code"] else "INTRA",
                                            "pos": entry["pos"], "rt": key[1],
                                            "typ": "OE", "txval": 0, "iamt": 0, "camt": 0, "samt": 0, "csamt": 0})
            for l in inv.get("lines", []):
                agg["txval"] += l["taxable"]
                agg["iamt"] += l["igst"]
                agg["camt"] += l["cgst"]
                agg["samt"] += l["sgst"]
    payload = {"gstin": company["gstin"], "fp": month[5:7] + month[:4], "gt": 0, "cur_gt": 0,
               "b2b": list(b2b_map.values()), "b2cs": list(b2cs_map.values()),
               "cdnr": list(cdnr_map.values()),
               "_meta": {"generated_by": "TechHind Finance", "note": "Simplified GSTR-1 JSON (sandbox format)"}}
    return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="GSTR1-{month}.json"'})


@router.get("/reports/gstr3b")
async def gstr3b(month: str, user=Depends(require_roles(*ALL_ROLES))):
    company = await get_company()
    invs = await db.invoices.find({**_month_docs(month), "doc_type": "INV"}, {"_id": 0}).to_list(5000)
    cns = await db.invoices.find({**_month_docs(month), "doc_type": "CN"}, {"_id": 0}).to_list(5000)
    bills = await db.purchase_bills.find(
        {"bill_date": month_date_range(month), "status": {"$nin": ["draft"]}, "itc_eligible": True},
        {"_id": 0},
    ).to_list(5000)
    out_taxable = r2(sum(i["total_taxable"] for i in invs) - sum(c["total_taxable"] for c in cns))
    out_igst = r2(sum(i["total_igst"] for i in invs) - sum(c["total_igst"] for c in cns))
    out_cgst = r2(sum(i["total_cgst"] for i in invs) - sum(c["total_cgst"] for c in cns))
    out_sgst = r2(sum(i["total_sgst"] for i in invs) - sum(c["total_sgst"] for c in cns))
    itc_igst = r2(sum(b["total_igst"] for b in bills))
    itc_cgst = r2(sum(b["total_cgst"] for b in bills))
    itc_sgst = r2(sum(b["total_sgst"] for b in bills))
    payload = {
        "gstin": company["gstin"], "ret_period": month[5:7] + month[:4],
        "sup_details": {"osup_det": {"txval": out_taxable, "iamt": out_igst, "camt": out_cgst, "samt": out_sgst, "csamt": 0},
                        "osup_zero": {"txval": 0, "iamt": 0, "csamt": 0},
                        "osup_nil_exmp": {"txval": 0}, "isup_rev": {"txval": 0, "iamt": 0, "camt": 0, "samt": 0, "csamt": 0},
                        "osup_nongst": {"txval": 0}},
        "inter_sup": {"unreg_details": [], "comp_details": [], "uin_details": []},
        "itc_elg": {"itc_avl": [{"ty": "IMPG", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0},
                                 {"ty": "ISRC", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0},
                                 {"ty": "ISD", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0},
                                 {"ty": "OTH", "iamt": itc_igst, "camt": itc_cgst, "samt": itc_sgst, "csamt": 0}],
                     "itc_rev": [], "itc_net": {"iamt": itc_igst, "camt": itc_cgst, "samt": itc_sgst, "csamt": 0},
                     "itc_inelg": []},
        "_meta": {"generated_by": "TechHind Finance", "note": "Simplified GSTR-3B summary JSON (sandbox format)"},
    }
    return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="GSTR3B-{month}.json"'})


@router.get("/reports/month-summary")
async def month_tax_summary(month: str, user=Depends(require_roles(*ALL_ROLES))):
    """Dense on-screen summary for Accountant Pack (tax + TDS)."""
    date_rng = month_date_range(month)
    invs = await db.invoices.find(
        {"invoice_date": date_rng, "doc_type": "INV", "status": {"$nin": ["draft", "cancelled"]}},
        {"_id": 0},
    ).to_list(5000)
    cns = await db.invoices.find(
        {"invoice_date": date_rng, "doc_type": "CN", "status": {"$nin": ["draft", "cancelled"]}},
        {"_id": 0},
    ).to_list(5000)
    pays = await db.payments.find({"payment_date": date_rng}, {"_id": 0}).to_list(5000)
    vouchers = await db.expense_vouchers.find(
        {"voucher_date": date_rng, "status": "posted"}, {"_id": 0}
    ).to_list(5000)
    open_ar = await db.invoices.count_documents(
        {"doc_type": "INV", "status": {"$in": ["approved", "partially_paid"]}, "balance": {"$gt": 0}}
    )
    posted_bills = await db.purchase_bills.find(
        {"bill_date": date_rng, "status": {"$nin": ["draft", "cancelled"]}}, {"_id": 0, "id": 1}
    ).to_list(5000)
    vpays = await db.vendor_payments.find({"payment_date": date_rng}, {"_id": 0}).to_list(5000)
    attachment_count = sum(len(v.get("attachments") or []) for v in vouchers)

    out_taxable = r2(sum(i.get("total_taxable", 0) for i in invs) - sum(c.get("total_taxable", 0) for c in cns))
    out_cgst = r2(sum(i.get("total_cgst", 0) for i in invs) - sum(c.get("total_cgst", 0) for c in cns))
    out_sgst = r2(sum(i.get("total_sgst", 0) for i in invs) - sum(c.get("total_sgst", 0) for c in cns))
    out_igst = r2(sum(i.get("total_igst", 0) for i in invs) - sum(c.get("total_igst", 0) for c in cns))
    out_grand = r2(sum(i.get("grand_total", 0) for i in invs) - sum(c.get("grand_total", 0) for c in cns))
    receipts_cash = r2(sum(p.get("amount", 0) for p in pays))
    receipts_tds = r2(sum(p.get("tds_amount", 0) or 0 for p in pays))
    expense_total = r2(sum(v.get("total", 0) for v in vouchers))
    vpay_total = r2(sum(p.get("amount", 0) for p in vpays))

    return {
        "month": month,
        "invoice_count": len(invs),
        "cn_count": len(cns),
        "outward_taxable": out_taxable,
        "outward_cgst": out_cgst,
        "outward_sgst": out_sgst,
        "outward_igst": out_igst,
        "outward_grand": out_grand,
        "receipts_cash": receipts_cash,
        "receipts_tds": receipts_tds,
        "receipts_count": len(pays),
        "expense_total": expense_total,
        "expense_count": len(vouchers),
        "open_ar_count": open_ar,
        "receipt_pdf_count": len(pays),
        "voucher_pdf_count": len(vouchers),
        "bill_pdf_count": len(posted_bills),
        "attachment_count": attachment_count,
        "vendor_payment_count": len(vpays),
        "vendor_payment_total": vpay_total,
    }


def _csv(rows, header):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def _safe_name(s: str) -> str:
    return (s or "doc").replace("/", "-").replace("\\", "-")


@router.get("/accountant-pack")
async def accountant_pack(month: str, user=Depends(require_roles(*ALL_ROLES))):
    import os
    import storage as storage_mod

    company = await get_company()
    date_rng = month_date_range(month)
    invs = await db.invoices.find(
        {"invoice_date": date_rng, "status": {"$ne": "draft"}}, {"_id": 0}
    ).sort("invoice_date", 1).to_list(5000)
    bills = await db.purchase_bills.find(
        {"bill_date": date_rng, "status": {"$ne": "draft"}}, {"_id": 0}
    ).sort("bill_date", 1).to_list(5000)
    vouchers = await db.expense_vouchers.find(
        {"voucher_date": date_rng, "status": "posted"}, {"_id": 0}
    ).sort("voucher_date", 1).to_list(5000)
    pays = await db.payments.find({"payment_date": date_rng}, {"_id": 0}).to_list(5000)
    vpays = await db.vendor_payments.find({"payment_date": date_rng}, {"_id": 0}).to_list(5000)

    open_inv = await db.invoices.find({"doc_type": "INV", "status": {"$in": ["approved", "partially_paid"]},
                                       "balance": {"$gt": 0}}, {"_id": 0}).to_list(5000)
    open_bills = await db.purchase_bills.find({"status": {"$in": ["posted", "partially_paid"]},
                                               "balance": {"$gt": 0}}, {"_id": 0}).to_list(5000)

    sales_csv = _csv([[i["invoice_no"], i["doc_type"], i["invoice_date"],
                       (i.get("customer_snapshot") or {}).get("legal_name", ""),
                       (i.get("customer_snapshot") or {}).get("gstin", ""),
                       i["place_of_supply"]["code"], f'{i["total_taxable"]:.2f}', f'{i["total_cgst"]:.2f}',
                       f'{i["total_sgst"]:.2f}', f'{i["total_igst"]:.2f}', f'{i["round_off"]:.2f}',
                       f'{i["grand_total"]:.2f}', i["status"], "Y" if i.get("reverse_charge") else "N",
                       i.get("irn") or ""] for i in invs],
                     ["Doc No", "Type", "Date", "Customer", "GSTIN", "POS", "Taxable", "CGST", "SGST",
                      "IGST", "RoundOff", "Total", "Status", "RCM", "IRN"])
    purchase_csv = _csv([[b["bill_no"], b["bill_date"], (b.get("vendor_snapshot") or {}).get("name", ""),
                          (b.get("vendor_snapshot") or {}).get("gstin", ""), f'{b["total_taxable"]:.2f}',
                          f'{b["total_tax"]:.2f}', f'{b["grand_total"]:.2f}',
                          "Y" if b.get("itc_eligible") else "N", b["status"]] for b in bills],
                        ["Bill No", "Date", "Vendor", "GSTIN", "Taxable", "GST", "Total", "ITC", "Status"])
    expense_csv = _csv([[v.get("voucher_no") or "", v["voucher_date"], v["category"], v["narration"],
                         v.get("vendor_name", ""), f'{v["amount"]:.2f}', f'{v["tax_amount"]:.2f}',
                         f'{v["total"]:.2f}', v.get("paid_via", ""), v["type"]] for v in vouchers],
                       ["Voucher No", "Date", "Category", "Narration", "Payee", "Amount", "Tax",
                        "Total", "Paid Via", "Type"])
    receipts_csv = _csv([[p["receipt_no"], p["payment_date"], p.get("customer_name", ""), p["method"],
                          f'{p["amount"]:.2f}', f'{p.get("tds_amount", 0):.2f}', f'{p.get("unallocated", 0):.2f}',
                          ", ".join(a.get("invoice_no", "") for a in p.get("allocations", []))] for p in pays],
                        ["Receipt No", "Date", "Customer", "Method", "Amount", "TDS", "Unallocated", "Invoices"])
    vpay_csv = _csv([[p.get("payment_ref", ""), p.get("payment_date", ""), p.get("vendor_name", ""),
                      p.get("method", ""), f'{p.get("amount", 0):.2f}', p.get("reference_no", ""),
                      ", ".join(a.get("bill_no", "") for a in p.get("allocations", []))] for p in vpays],
                    ["Ref", "Date", "Vendor", "Method", "Amount", "Bank Ref", "Bills"])
    ar_csv = _csv([[i["invoice_no"], (i.get("customer_snapshot") or {}).get("legal_name", ""),
                    i.get("due_date") or "", f'{i["grand_total"]:.2f}', f'{i["balance"]:.2f}'] for i in open_inv],
                  ["Invoice No", "Customer", "Due Date", "Total", "Balance"])
    ap_csv = _csv([[b["bill_no"], (b.get("vendor_snapshot") or {}).get("name", ""), b.get("due_date") or "",
                    f'{b["grand_total"]:.2f}', f'{b["balance"]:.2f}'] for b in open_bills],
                  ["Bill No", "Vendor", "Due Date", "Total", "Balance"])

    MAX_PACK_PDFS = int(os.environ.get("ACCOUNTANT_PACK_MAX_PDFS") or 100)
    MAX_ATTACH = int(os.environ.get("ACCOUNTANT_PACK_MAX_ATTACHMENTS") or 200)
    pdf_budget = MAX_PACK_PDFS
    attach_budget = MAX_ATTACH
    skips: list[str] = []
    counts = {
        "invoice_pdfs": 0, "receipt_pdfs": 0, "voucher_pdfs": 0,
        "bill_pdfs": 0, "attachments": 0,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{month}/sales_register.csv", sales_csv)
        z.writestr(f"{month}/purchase_register.csv", purchase_csv)
        z.writestr(f"{month}/expense_register.csv", expense_csv)
        z.writestr(f"{month}/receipts_register.csv", receipts_csv)
        z.writestr(f"{month}/vendor_payments_register.csv", vpay_csv)
        z.writestr(f"{month}/ar_outstanding.csv", ar_csv)
        z.writestr(f"{month}/ap_outstanding.csv", ap_csv)

        for i in invs:
            if pdf_budget <= 0:
                skips.append(f"invoice PDF cap: skipped remaining after {counts['invoice_pdfs']}")
                break
            try:
                html = pdfmod.render_invoice_html(i, company)
                data = await pdfmod.build_pdf(html)
                z.writestr(f"{month}/pdfs/{_safe_name(i.get('invoice_no') or i['id'])}.pdf", data)
                counts["invoice_pdfs"] += 1
                pdf_budget -= 1
            except Exception as e:
                skips.append(f"invoice {i.get('invoice_no')}: {e}")

        for p in pays:
            if pdf_budget <= 0:
                skips.append("receipt PDF cap reached")
                break
            try:
                cust = await db.customers.find_one({"id": p.get("customer_id")}, {"_id": 0}) or {
                    "legal_name": p.get("customer_name", ""), "gstin": "", "billing_address": ""
                }
                html = pdfmod.render_receipt_html(p, company, cust, p.get("allocations", []))
                data = await pdfmod.build_pdf(html)
                z.writestr(f"{month}/receipts/{_safe_name(p.get('receipt_no') or p['id'])}.pdf", data)
                counts["receipt_pdfs"] += 1
                pdf_budget -= 1
            except Exception as e:
                skips.append(f"receipt {p.get('receipt_no')}: {e}")

        for v in vouchers:
            if pdf_budget <= 0:
                skips.append("voucher PDF cap reached")
                break
            try:
                html = pdfmod.render_voucher_html(v, company)
                data = await pdfmod.build_pdf(html)
                z.writestr(f"{month}/vouchers/{_safe_name(v.get('voucher_no') or v['id'])}.pdf", data)
                counts["voucher_pdfs"] += 1
                pdf_budget -= 1
            except Exception as e:
                skips.append(f"voucher {v.get('voucher_no')}: {e}")
            vno = _safe_name(v.get("voucher_no") or v["id"])
            for a in v.get("attachments") or []:
                if attach_budget <= 0:
                    skips.append("attachment cap reached")
                    break
                path = a.get("path") or ""
                got = storage_mod.get_object_or_none(path)
                if not got:
                    skips.append(f"attachment missing: {a.get('name')}")
                    continue
                data, _ctype = got
                fname = a.get("name") or path.split("/")[-1]
                z.writestr(f"{month}/voucher_attachments/{vno}/{fname}", data)
                counts["attachments"] += 1
                attach_budget -= 1

        for b in bills:
            if pdf_budget <= 0:
                skips.append("bill PDF cap reached")
                break
            try:
                html = pdfmod.render_bill_html(b, company)
                data = await pdfmod.build_pdf(html)
                z.writestr(f"{month}/bills/{_safe_name(b.get('bill_no') or b['id'])}.pdf", data)
                counts["bill_pdfs"] += 1
                pdf_budget -= 1
            except Exception as e:
                skips.append(f"bill {b.get('bill_no')}: {e}")

        manifest = [
            f"TechHind Accountant Pack — {month}",
            f"Generated for CA handoff (sandbox GSTR JSON separate on Accountant Pack page).",
            "",
            "Registers: sales, purchase, expense, receipts (+TDS), vendor_payments, AR, AP",
            f"Invoice PDFs: {counts['invoice_pdfs']}",
            f"Receipt PDFs: {counts['receipt_pdfs']}",
            f"Expense voucher PDFs: {counts['voucher_pdfs']}",
            f"Purchase bill PDFs: {counts['bill_pdfs']}",
            f"Voucher attachments: {counts['attachments']}",
            "",
            "Skips / notes:",
            *(skips or ["(none)"]),
        ]
        z.writestr(f"{month}/MANIFEST.txt", "\n".join(manifest) + "\n")

    await audit(user, "accountant_pack", "report", month, f"Accountant pack generated for {month}")
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="accountant-pack-{month}.zip"'})
