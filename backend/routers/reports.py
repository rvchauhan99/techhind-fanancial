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


def _csv(rows, header):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


@router.get("/accountant-pack")
async def accountant_pack(month: str, user=Depends(require_roles(*ALL_ROLES))):
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
    ar_csv = _csv([[i["invoice_no"], (i.get("customer_snapshot") or {}).get("legal_name", ""),
                    i.get("due_date") or "", f'{i["grand_total"]:.2f}', f'{i["balance"]:.2f}'] for i in open_inv],
                  ["Invoice No", "Customer", "Due Date", "Total", "Balance"])
    ap_csv = _csv([[b["bill_no"], (b.get("vendor_snapshot") or {}).get("name", ""), b.get("due_date") or "",
                    f'{b["grand_total"]:.2f}', f'{b["balance"]:.2f}'] for b in open_bills],
                  ["Bill No", "Vendor", "Due Date", "Total", "Balance"])

    MAX_PACK_PDFS = int(__import__("os").environ.get("ACCOUNTANT_PACK_MAX_PDFS") or 100)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{month}/sales_register.csv", sales_csv)
        z.writestr(f"{month}/purchase_register.csv", purchase_csv)
        z.writestr(f"{month}/expense_register.csv", expense_csv)
        z.writestr(f"{month}/receipts_register.csv", receipts_csv)
        z.writestr(f"{month}/ar_outstanding.csv", ar_csv)
        z.writestr(f"{month}/ap_outstanding.csv", ap_csv)
        for i in invs[:MAX_PACK_PDFS]:
            try:
                html = pdfmod.render_invoice_html(i, company)
                data = await pdfmod.build_pdf(html)
                z.writestr(f"{month}/pdfs/{(i.get('invoice_no') or i['id']).replace('/', '-')}.pdf", data)
            except Exception:
                pass
    await audit(user, "accountant_pack", "report", month, f"Accountant pack generated for {month}")
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="accountant-pack-{month}.zip"'})
