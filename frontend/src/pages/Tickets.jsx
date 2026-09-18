import React, { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, LifeBuoy } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDateTime } from "../lib/format"
import Layout, { Empty, StatusBadge } from "../components/Layout"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

export default function Tickets() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [customers, setCustomers] = useState([])
  const [form, setForm] = useState({
    customer_id: "",
    subject: "",
    body: "",
    priority: "normal",
    requester_name: "",
    requester_email: "",
  })

  useEffect(() => {
    const params = {}
    if (status !== "all") params.status = status
    if (q.trim()) params.q = q.trim()
    api
      .get("/tickets", { params })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
  }, [status, q])

  useEffect(() => {
    if (open) {
      api.get("/customers").then((r) => setCustomers(r.data || [])).catch(() => {})
    }
  }, [open])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post("/tickets", form)
      toast.success(`Ticket ${data.number} created`)
      setOpen(false)
      setForm({
        customer_id: "",
        subject: "",
        body: "",
        priority: "normal",
        requester_name: "",
        requester_email: "",
      })
      navigate(`/tickets/${data.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Layout
      title="Support Tickets"
      actions={
        <div className="flex items-center gap-2">
          <Input
            data-testid="tickets-search"
            className="h-8 w-48 text-xs"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const params = {}
                if (status !== "all") params.status = status
                if (q.trim()) params.q = q.trim()
                api.get("/tickets", { params }).then((r) => setRows(r.data)).catch(() => setRows([]))
              }
            }}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="tickets-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          {can("admin", "accountant", "ops") && (
            <Button
              data-testid="new-ticket-btn"
              size="sm"
              onClick={() => setOpen(true)}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white"
            >
              <Plus className="w-4 h-4 mr-1" /> New Ticket
            </Button>
          )}
        </div>
      }
    >
      <div className="bg-white border border-slate-200 rounded-lg" data-testid="tickets-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Number</th>
              <th className="text-left px-3 py-2">Subject</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Priority</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((t) => (
              <tr
                key={t.id}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate(`/tickets/${t.id}`)}
                data-testid={`ticket-row-${t.id}`}
              >
                <td className="px-3 py-1.5 font-mono text-xs text-[#0066CC]">
                  <Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>
                    {t.number}
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-medium">{t.subject}</td>
                <td className="px-3 py-1.5 text-xs">{t.customer_name}</td>
                <td className="px-3 py-1.5 text-xs capitalize">{t.source}</td>
                <td className="px-3 py-1.5 text-xs capitalize">{t.priority}</td>
                <td className="px-3 py-1.5">
                  <StatusBadge value={t.status} />
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{fmtDateTime(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No tickets" />}
        {rows === null && (
          <div className="px-3 py-6 text-sm text-slate-500 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" /> Loading…
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="new-ticket-dialog">
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleCreate}>
            <div>
              <Label className="text-xs">Customer</Label>
              <Select
                value={form.customer_id}
                onValueChange={(v) => setForm({ ...form, customer_id: v })}
              >
                <SelectTrigger data-testid="ticket-customer" className="h-8 text-xs">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.legal_name}
                      {c.crm_tenant_key ? ` (${c.crm_tenant_key})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                data-testid="ticket-subject"
                className="h-8 text-xs"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                required
              />
            </div>
            <div>
              <Label className="text-xs">Message</Label>
              <textarea
                data-testid="ticket-body"
                className="w-full border rounded-md px-2 py-1.5 text-xs min-h-[88px]"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requester email</Label>
                <Input
                  className="h-8 text-xs"
                  value={form.requester_email}
                  onChange={(e) => setForm({ ...form, requester_email: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-[#0F284E] text-white" data-testid="ticket-create-submit">
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
