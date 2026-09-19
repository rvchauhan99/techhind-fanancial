import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const BUCKETS = ["current", "0-30", "31-60", "61-90", "90+"];
const BUCKET_CLS = { current: "text-slate-600", "0-30": "text-blue-700", "31-60": "text-amber-700", "61-90": "text-orange-700", "90+": "text-red-700" };

const SCHEMA = [
  { key: "as_of", type: FIELD.DATE, label: "As of", width: "w-36" },
  { key: "q", type: FIELD.TEXT, label: "Party / doc", placeholder: "Search…", width: "w-40" },
  { key: "bucket", type: FIELD.SELECT, label: "Bucket", width: "w-32",
    options: BUCKETS.map((b) => ({ value: b, label: b })) },
  { key: "min_balance", type: FIELD.NUMBER, label: "Min balance", width: "w-28", placeholder: "0" },
];

function AgingTable({ tid, data, type }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg" data-testid={tid}>
      <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{type === "ar" ? "Accounts Receivable" : "Accounts Payable"}</h3>
        <div className="flex gap-3 text-xs">
          {BUCKETS.map((b) => (
            <span key={b} data-testid={`${tid}-bucket-${b}`} className={`font-mono font-semibold ${BUCKET_CLS[b]}`}>
              {b}: {fmtINR(data.buckets[b]?.amount || 0)}</span>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
          <th className="text-left px-3 py-2">{type === "ar" ? "Invoice" : "Bill"}</th>
          <th className="text-left px-3 py-2">{type === "ar" ? "Customer" : "Vendor"}</th>
          <th className="text-left px-3 py-2">Due Date</th>
          <th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Balance</th>
          <th className="text-right px-3 py-2">Days Overdue</th><th className="text-left px-3 py-2">Bucket</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
              <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC]">{r.invoice_no || r.bill_no}</td>
              <td className="px-3 py-2">{r.party}</td>
              <td className="px-3 py-2 text-xs">{fmtDate(r.due_date)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtINR(r.grand_total)}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(r.balance)}</td>
              <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${r.days_overdue > 0 ? "text-red-600" : "text-slate-400"}`}>
                {r.days_overdue > 0 ? r.days_overdue : "—"}</td>
              <td className={`px-3 py-2 text-xs font-semibold ${BUCKET_CLS[r.bucket]}`}>{r.bucket}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <Empty label="Nothing open — all clear" />}
    </div>
  );
}

export default function Aging() {
  const [ar, setAr] = useState(null);
  const [ap, setAp] = useState(null);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA);

  useEffect(() => {
    api.get("/aging/ar", { params: apiParams }).then((r) => setAr(r.data)).catch(() => {});
    api.get("/aging/ap", { params: apiParams }).then((r) => setAp(r.data)).catch(() => {});
  }, [apiParams]);

  return (
    <Layout title="AR / AP Aging">
      <FilterBar schema={SCHEMA} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="aging-filters" />
      {ar && <AgingTable tid="ar-aging-table" data={ar} type="ar" />}
      {ap && <AgingTable tid="ap-aging-table" data={ap} type="ap" />}
    </Layout>
  );
}
