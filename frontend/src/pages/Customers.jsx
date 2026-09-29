import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Pencil } from "lucide-react"
import api from "../lib/api"
import { INDIAN_STATES } from "../lib/format"
import Layout, { Empty } from "../components/Layout"
import CustomerFormDialog from "../components/CustomerFormDialog"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import FilterBar, { FIELD } from "../components/filters/FilterBar"
import { useListFilters } from "../hooks/useListFilters"

const SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Name / GSTIN…", width: "w-48" },
  { key: "state_code", type: FIELD.SELECT, label: "State", width: "w-48",
    options: INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} — ${name}` })) },
  { key: "has_gstin", type: FIELD.TOGGLE, label: "GSTIN", placeholder: "Has GSTIN" },
]

export default function Customers() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA)

  const load = () => api.get("/customers", { params: apiParams }).then((r) => setRows(r.data)).catch(() => {})
  useEffect(() => { load() }, [apiParams]) // eslint-disable-line

  const canWrite = can("admin", "accountant", "ops")

  const openNew = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c)
    setOpen(true)
  }

  const handleOpenChange = (v) => {
    setOpen(v)
    if (!v) setEditing(null)
  }

  return (
    <Layout
      title="Customers 360"
      actions={canWrite && (
        <Button data-testid="new-customer-btn" onClick={openNew} className="bg-[#0F284E] hover:bg-[#17386D] text-white" size="sm">
          <Plus className="w-4 h-4 mr-1" /> New Customer
        </Button>
      )}
    >
      <FilterBar schema={SCHEMA} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="customer-filters" />
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm pwa-table" data-testid="customers-table">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2 font-semibold">Customer</th>
              <th className="text-left px-3 py-2 font-semibold">GSTIN</th>
              <th className="text-left px-3 py-2 font-semibold">State</th>
              <th className="text-left px-3 py-2 font-semibold">Contact</th>
              <th className="text-left px-3 py-2 font-semibold">CRM Ref</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((c) => (
              <tr
                key={c.id}
                data-testid={`customer-row-${c.id}`}
                onClick={() => navigate(`/customers/${c.id}`)}
                className="border-t border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{c.legal_name}</div>
                  <div className="text-xs text-slate-500">{c.trade_name}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{c.gstin || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.state} ({c.state_code})</td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {(c.contacts || [])[0]?.name}<br />{(c.contacts || [])[0]?.email}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.crm_tenant_key || "—"}</td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <button
                      type="button"
                      data-testid={`edit-customer-${c.id}`}
                      aria-label={`Edit ${c.legal_name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(c)
                      }}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No customers found" />}
      </div>

      <CustomerFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        customer={editing}
        onSaved={() => load()}
      />
    </Layout>
  )
}
