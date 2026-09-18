import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtDateTime } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const ENTITY_TYPES = ["user", "company", "masters", "customer", "product", "subscription", "vendor",
  "invoice", "payment", "purchase_bill", "vendor_payment", "expense_voucher", "period", "import", "system"];

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [type, setType] = useState("");

  useEffect(() => {
    api.get("/audit", { params: { entity_type: type } }).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [type]);

  return (
    <Layout title="Audit Trail">
      <div className="flex items-center gap-2">
        <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
          <SelectTrigger data-testid="audit-type-filter" className="w-56 h-8 bg-white"><SelectValue placeholder="All entities" /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All entities</SelectItem>
            {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Timestamp</th><th className="text-left px-3 py-2">User</th>
            <th className="text-left px-3 py-2">Role</th><th className="text-left px-3 py-2">IP</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-left px-3 py-2">Entity</th><th className="text-left px-3 py-2">Summary</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id} data-testid={`audit-row-${r.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{fmtDateTime(r.ts)}</td>
                <td className="px-3 py-2 text-xs font-medium">{r.user_name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.role}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500" data-testid={`audit-ip-${r.id}`}>{r.ip || "—"}</td>
                <td className="px-3 py-2"><span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">{r.action}</span></td>
                <td className="px-3 py-2 text-xs text-slate-500 font-mono">{r.entity_type}</td>
                <td className="px-3 py-2 text-xs text-slate-700">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No audit entries" />}
      </div>
    </Layout>
  );
}
