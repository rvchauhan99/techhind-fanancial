import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Upload, Plus, ArrowLeftRight, Link2 } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const SOURCE_LABELS = {
  payment: "Receipt",
  vendor_payment: "Vendor pay",
  expense_voucher: "Expense",
  transfer: "Transfer",
  manual: "Manual",
  import: "Import",
  opening: "Opening",
};

export default function BankStatement() {
  const { id } = useParams();
  const { can } = useAuth();
  const [stmt, setStmt] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [xferOpen, setXferOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRow, setLinkRow] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [manual, setManual] = useState({
    txn_date: new Date().toISOString().slice(0, 10), narration: "", reference_no: "",
    side: "debit", amount: "",
  });
  const [xfer, setXfer] = useState({
    to_bank_id: "", amount: "", txn_date: new Date().toISOString().slice(0, 10),
    narration: "", reference_no: "",
  });
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef();

  const load = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (sourceType) params.source_type = sourceType;
    if (unlinkedOnly) params.unlinked_only = true;
    api.get(`/banks/${id}/statement`, { params }).then((r) => setStmt(r.data)).catch(() => setStmt(null));
  };

  useEffect(() => { load(); }, [id, dateFrom, dateTo, sourceType, unlinkedOnly]); // eslint-disable-line
  useEffect(() => {
    api.get("/banks").then((r) => setAccounts(r.data)).catch(() => {});
  }, []);

  const submitManual = async (e) => {
    e.preventDefault();
    try {
      const amt = Number(manual.amount);
      await api.post(`/banks/${id}/manual`, {
        txn_date: manual.txn_date,
        narration: manual.narration,
        reference_no: manual.reference_no,
        debit: manual.side === "debit" ? amt : 0,
        credit: manual.side === "credit" ? amt : 0,
      });
      toast.success("Manual entry posted");
      setManualOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const submitXfer = async (e) => {
    e.preventDefault();
    try {
      await api.post("/banks/transfer", {
        from_bank_id: id,
        to_bank_id: xfer.to_bank_id,
        amount: Number(xfer.amount),
        txn_date: xfer.txn_date,
        narration: xfer.narration,
        reference_no: xfer.reference_no,
      });
      toast.success("Transfer posted");
      setXferOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const runImport = async (commit) => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const path = commit ? `/banks/${id}/import/commit` : `/banks/${id}/import/dry-run`;
      const r = await api.post(path, fd);
      setImportResult(r.data);
      toast.success(commit ? `Imported ${r.data.valid} lines` : `Dry-run: ${r.data.valid} valid`);
      if (commit) load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const openLink = async (row) => {
    setLinkRow(row);
    setLinkOpen(true);
    setSuggestions(null);
    if (row.reference_no) {
      try {
        const r = await api.get("/banks/match-suggestions", { params: { reference_no: row.reference_no } });
        setSuggestions(r.data);
      } catch {
        setSuggestions(null);
      }
    }
  };

  const applyLink = async (kind, doc) => {
    try {
      const payload = {
        linked_kind: kind,
        linked_id: doc.id,
        linked_no: doc.receipt_no || doc.payment_ref || doc.voucher_no || doc.invoice_no || "",
        linked_path: kind === "payment" ? "/payments"
          : kind === "vendor_payment" ? "/vendors"
            : kind === "expense_voucher" ? "/expenses"
              : kind === "invoice" ? `/invoices/${doc.id}` : "",
      };
      await api.post(`/banks/ledger/${linkRow.id}/link`, payload);
      toast.success("Linked");
      setLinkOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const acct = stmt?.account;
  const title = acct ? `${acct.bank_name} statement` : "Bank statement";

  return (
    <Layout
      title={title}
      actions={(
        <div className="flex gap-2 flex-wrap">
          <Link to="/banks" className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-[#0066CC]"
            data-testid="back-banks">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Accounts
          </Link>
          {can("admin", "accountant") && (
            <>
              <Button data-testid="bank-import-btn" size="sm" variant="outline" onClick={() => { setImportResult(null); setImportOpen(true); }}>
                <Upload className="w-3.5 h-3.5 mr-1" /> Import
              </Button>
              <Button data-testid="bank-manual-btn" size="sm" variant="outline" onClick={() => setManualOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Manual
              </Button>
              <Button data-testid="bank-transfer-btn" size="sm" variant="outline" onClick={() => setXferOpen(true)}>
                <ArrowLeftRight className="w-3.5 h-3.5 mr-1" /> Transfer
              </Button>
            </>
          )}
        </div>
      )}
    >
      {acct && (
        <div className="flex flex-wrap items-center gap-4 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2"
          data-testid="statement-header">
          <div>
            <span className="text-[11px] uppercase text-slate-500 font-semibold">Live balance</span>
            <div className="font-mono font-bold text-lg text-emerald-700">{fmtINR(stmt.live_balance)}</div>
          </div>
          <div>
            <span className="text-[11px] uppercase text-slate-500 font-semibold">Opening (range)</span>
            <div className="font-mono font-semibold">{fmtINR(stmt.opening_balance)}</div>
          </div>
          <div className="text-xs text-slate-500 font-mono">{acct.account_no || "Cash"} · {acct.ifsc || "—"}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Input data-testid="stmt-from" type="date" className="h-8 w-36 bg-white" value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} />
        <Input data-testid="stmt-to" type="date" className="h-8 w-36 bg-white" value={dateTo}
          onChange={(e) => setDateTo(e.target.value)} />
        <Select value={sourceType || "all"} onValueChange={(v) => setSourceType(v === "all" ? "" : v)}>
          <SelectTrigger data-testid="stmt-source-filter" className="h-8 w-40 bg-white"><SelectValue placeholder="All sources" /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All sources</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)}
            data-testid="stmt-unlinked-only" />
          Unlinked only
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-sm" data-testid="statement-table">
          <thead className="sticky top-0">
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Narration</th>
              <th className="text-left px-3 py-2">Ref</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Linked</th>
              <th className="text-right px-3 py-2">Withdrawal</th>
              <th className="text-right px-3 py-2">Deposit</th>
              <th className="text-right px-3 py-2">Balance</th>
              <th className="text-right px-3 py-2">Bank Close</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(stmt?.items || []).map((row, i) => (
              <tr key={row.id} data-testid={`stmt-row-${row.id}`}
                className={`border-t border-slate-100 ${i % 2 ? "bg-slate-50/60" : ""} ${row.recon_mismatch ? "bg-amber-50" : ""}`}>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap">{fmtDate(row.txn_date)}</td>
                <td className="px-3 py-1.5 text-xs max-w-xs truncate" title={row.narration}>{row.narration}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{row.reference_no || "—"}</td>
                <td className="px-3 py-1.5 text-[10px] uppercase text-slate-500">{SOURCE_LABELS[row.source_type] || row.source_type}</td>
                <td className="px-3 py-1.5 text-xs">
                  {row.linked_path && row.linked_no ? (
                    <Link to={row.linked_path} className="font-mono text-[#0066CC] hover:underline" data-testid={`stmt-link-${row.id}`}>
                      {row.linked_no}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-red-700">{row.debit > 0 ? fmtINR(row.debit) : ""}</td>
                <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{row.credit > 0 ? fmtINR(row.credit) : ""}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtINR(row.running_balance)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs text-slate-500">
                  {row.bank_closing != null ? fmtINR(row.bank_closing) : ""}
                  {row.recon_mismatch && <span className="block text-[9px] text-amber-700">Δ {fmtINR(row.recon_diff)}</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {can("admin", "accountant") && ["import", "manual"].includes(row.source_type) && !row.linked_id && (
                    <button type="button" data-testid={`stmt-link-btn-${row.id}`} onClick={() => openLink(row)}
                      className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-[#0066CC]" title="Link to CRM doc">
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stmt && !stmt.items?.length && <Empty label="No ledger lines in this range" />}
      </div>

      {/* Manual */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="manual-dialog">
          <DialogHeader><DialogTitle className="font-heading">Manual entry</DialogTitle></DialogHeader>
          <form onSubmit={submitManual} className="space-y-3">
            <div><Label>Date *</Label>
              <Input type="date" required value={manual.txn_date} onChange={(e) => setManual({ ...manual, txn_date: e.target.value })} /></div>
            <div><Label>Narration *</Label>
              <Input data-testid="manual-narration" required value={manual.narration}
                onChange={(e) => setManual({ ...manual, narration: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Side</Label>
                <Select value={manual.side} onValueChange={(v) => setManual({ ...manual, side: v })}>
                  <SelectTrigger data-testid="manual-side"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="debit">Withdrawal</SelectItem>
                    <SelectItem value="credit">Deposit</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>Amount *</Label>
                <Input data-testid="manual-amount" type="number" step="0.01" required className="font-mono"
                  value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></div>
            </div>
            <div><Label>Reference</Label>
              <Input className="font-mono" value={manual.reference_no}
                onChange={(e) => setManual({ ...manual, reference_no: e.target.value })} /></div>
            <div className="flex justify-end">
              <Button data-testid="manual-save" type="submit" className="bg-[#0F284E] hover:bg-[#17386D] text-white">Post</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transfer */}
      <Dialog open={xferOpen} onOpenChange={setXferOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="transfer-dialog">
          <DialogHeader><DialogTitle className="font-heading">Inter-bank transfer</DialogTitle></DialogHeader>
          <form onSubmit={submitXfer} className="space-y-3">
            <div><Label>To account *</Label>
              <Select value={xfer.to_bank_id} onValueChange={(v) => setXfer({ ...xfer, to_bank_id: v })}>
                <SelectTrigger data-testid="xfer-to"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent className="bg-white">
                  {accounts.filter((a) => a.id !== id).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.label || a.bank_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date *</Label>
                <Input type="date" required value={xfer.txn_date} onChange={(e) => setXfer({ ...xfer, txn_date: e.target.value })} /></div>
              <div><Label>Amount *</Label>
                <Input data-testid="xfer-amount" type="number" step="0.01" required className="font-mono"
                  value={xfer.amount} onChange={(e) => setXfer({ ...xfer, amount: e.target.value })} /></div>
            </div>
            <div><Label>Narration</Label>
              <Input value={xfer.narration} onChange={(e) => setXfer({ ...xfer, narration: e.target.value })} /></div>
            <div className="flex justify-end">
              <Button data-testid="xfer-save" type="submit" disabled={!xfer.to_bank_id}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Transfer</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-xl bg-white" data-testid="import-dialog">
          <DialogHeader><DialogTitle className="font-heading">Import bank statement</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">
            Columns: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal, Deposit, Closing
          </p>
          <Input data-testid="import-file" type="file" accept=".csv,text/csv" ref={fileRef} className="text-sm" />
          <div className="flex gap-2">
            <Button data-testid="import-dryrun" type="button" variant="outline" onClick={() => runImport(false)}>Dry-run</Button>
            <Button data-testid="import-commit" type="button" onClick={() => runImport(true)}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white">Commit</Button>
            <button type="button" data-testid="import-template-link"
              className="text-xs text-[#0066CC] self-center ml-auto hover:underline"
              onClick={async () => {
                try {
                  const r = await api.get("/banks/import/template", { responseType: "blob" });
                  const url = URL.createObjectURL(r.data);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "bank-statement-template.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  toast.error(apiError(err));
                }
              }}>Download template</button>
          </div>
          {importResult && (
            <div className="text-xs border border-slate-200 rounded p-2 max-h-48 overflow-auto" data-testid="import-result">
              <div className="font-semibold mb-1">{importResult.mode}: {importResult.valid} valid / {importResult.invalid} invalid</div>
              {(importResult.rows || []).slice(0, 30).map((r) => (
                <div key={r.row} className={r.ok ? "text-slate-600" : "text-red-600"}>
                  #{r.row} {r.ok ? (r.skipped ? "skipped" : r.summary) : r.error}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-lg bg-white" data-testid="link-dialog">
          <DialogHeader><DialogTitle className="font-heading">Link to CRM document</DialogTitle></DialogHeader>
          {linkRow && (
            <div className="text-xs text-slate-600 mb-2">
              {fmtDate(linkRow.txn_date)} · {linkRow.narration} · ref {linkRow.reference_no || "—"}
            </div>
          )}
          {!suggestions && <div className="text-xs text-slate-400">No auto-matches. Enter a ref on the statement line for suggestions.</div>}
          {suggestions && (
            <div className="space-y-3 text-sm max-h-72 overflow-auto">
              {(suggestions.payments || []).map((p) => (
                <button key={p.id} type="button" data-testid={`link-pay-${p.id}`}
                  onClick={() => applyLink("payment", p)}
                  className="w-full text-left border border-slate-200 rounded px-2 py-1.5 hover:bg-slate-50">
                  Receipt <span className="font-mono text-[#0066CC]">{p.receipt_no}</span> · {p.customer_name} · {fmtINR(p.amount)}
                </button>
              ))}
              {(suggestions.vendor_payments || []).map((p) => (
                <button key={p.id} type="button" onClick={() => applyLink("vendor_payment", p)}
                  className="w-full text-left border border-slate-200 rounded px-2 py-1.5 hover:bg-slate-50">
                  Vendor <span className="font-mono text-[#0066CC]">{p.payment_ref}</span> · {p.vendor_name} · {fmtINR(p.amount)}
                </button>
              ))}
              {(suggestions.vouchers || []).map((v) => (
                <button key={v.id} type="button" onClick={() => applyLink("expense_voucher", v)}
                  className="w-full text-left border border-slate-200 rounded px-2 py-1.5 hover:bg-slate-50">
                  Expense <span className="font-mono text-[#0066CC]">{v.voucher_no}</span> · {v.category} · {fmtINR(v.total)}
                </button>
              ))}
              {!suggestions.payments?.length && !suggestions.vendor_payments?.length && !suggestions.vouchers?.length && (
                <div className="text-xs text-slate-400">No matching documents for this reference.</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
