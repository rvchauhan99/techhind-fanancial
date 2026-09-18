import React, { useCallback, useEffect, useState } from "react"
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

function SlaBadge({ ticket }) {
  if (!ticket?.sla_due_at) return <span className="text-[10px] text-slate-400">—</span>
  if (ticket.sla_breached && !["resolved", "closed"].includes(ticket.status)) {
    return (
      <span
        className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200"
        data-testid="sla-breached"
      >
        Breached
      </span>
    )
  }
  if (["resolved", "closed"].includes(ticket.status)) {
    return <span className="text-[10px] text-slate-400">Done</span>
  }
  const due = new Date(ticket.sla_due_at)
  const hrs = Math.max(0, Math.round((due - Date.now()) / 3600000))
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
        hrs <= 4 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
      }`}
      data-testid="sla-ok"
    >
      {hrs}h
    </span>
  )
}

const QUEUE_CHIPS = [
  { key: "open", label: "All open", params: { status: "open" } },
  { key: "mine", label: "Mine", params: { mine: "true", status: "open" } },
  { key: "unassigned", label: "Unassigned", params: { unassigned: "true", status: "open" } },
  { key: "breached", label: "SLA breached", params: { sla: "breached" } },
]

export default function Tickets() {
  const { canCap } = useAuth()
  const navigate = useNavigate()
  const canWrite = canCap("can_ticket_write")
  const [rows, setRows] = useState(null)
  const [queue, setQueue] = useState({})
  const [meta, setMeta] = useState({ categories: [], assignees: [] })
  const [chip, setChip] = useState("open")
  const [status, setStatus] = useState("all")
  const [priority, setPriority] = useState("all")
  const [category, setCategory] = useState("all")
  const [assigneeId, setAssigneeId] = useState("all")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [customers, setCustomers] = useState([])
  const [form, setForm] = useState({
    customer_id: "",
    subject: "",
    body: "",
    priority: "normal",
    category: "other",
    assignee_id: "",
    requester_name: "",
    requester_email: "",
  })

  const loadQueue = useCallback(() => {
    api.get("/tickets/queue").then((r) => setQueue(r.data || {})).catch(() => {})
  }, [])

  const loadRows = useCallback(() => {
    const params = {}
    const chipDef = QUEUE_CHIPS.find((c) => c.key === chip)
    if (chipDef) Object.assign(params, chipDef.params)
    if (status !== "all" && chip === "open") params.status = status
    if (status !== "all" && !["open", "mine", "unassigned"].includes(chip)) params.status = status
    if (chip === "open" && status !== "all") params.status = status
    if (priority !== "all") params.priority = priority
    if (category !== "all") params.category = category
    if (assigneeId !== "all" && chip !== "mine" && chip !== "unassigned") params.assignee_id = assigneeId
    if (q.trim()) params.q = q.trim()
    api
      .get("/tickets", { params })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
  }, [chip, status, priority, category, assigneeId, q])

  useEffect(() => {
    api.get("/tickets/meta").then((r) => setMeta(r.data || {})).catch(() => {})
    loadQueue()
  }, [loadQueue])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  useEffect(() => {
    if (open) {
      api.get("/customers").then((r) => setCustomers(r.data || [])).catch(() => {})
    }
  }, [open])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form }
      if (!payload.assignee_id) delete payload.assignee_id
      const { data } = await api.post("/tickets", payload)
      toast.success(`Ticket ${data.number} created`)
      setOpen(false)
      setForm({
        customer_id: "",
        subject: "",
        body: "",
        priority: "normal",
        category: "other",
        assignee_id: "",
        requester_name: "",
        requester_email: "",
      })
      loadQueue()
      navigate(`/tickets/${data.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const chipCount = (key) => {
    if (key === "open") return queue.open
    if (key === "mine") return queue.mine
    if (key === "unassigned") return queue.unassigned
    if (key === "breached") return queue.breached
    return null
  }

  return (
    <Layout
      title="Support Tickets"
      actions={
        <div className="flex items-center gap-2">
          <Input
            data-testid="tickets-search"
            className="h-8 w-40 text-xs"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {canWrite && (
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
      <div className="flex flex-wrap gap-1.5 mb-2" data-testid="tickets-queue-chips">
        {QUEUE_CHIPS.map((c) => {
          const n = chipCount(c.key)
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`queue-chip-${c.key}`}
              onClick={() => {
                setChip(c.key)
                if (c.key === "open") setStatus("open")
              }}
              className={`h-7 px-2.5 rounded text-[11px] font-semibold border transition-colors ${
                chip === c.key
                  ? "bg-[#0F284E] text-white border-[#0F284E]"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              {c.label}
              {n != null && <span className="ml-1 opacity-80">({n})</span>}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2" data-testid="tickets-filters">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-7 w-28 text-[11px]" data-testid="tickets-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-7 w-28 text-[11px]" data-testid="tickets-priority-filter">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priority</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-7 w-32 text-[11px]" data-testid="tickets-category-filter">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(meta.categories || []).map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger className="h-7 w-36 text-[11px]" data-testid="tickets-assignee-filter">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {(meta.assignees || []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name || a.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="tickets-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-2 py-1.5">Number</th>
              <th className="text-left px-2 py-1.5">Subject</th>
              <th className="text-left px-2 py-1.5">Customer</th>
              <th className="text-left px-2 py-1.5">Category</th>
              <th className="text-left px-2 py-1.5">Assignee</th>
              <th className="text-left px-2 py-1.5">Priority</th>
              <th className="text-left px-2 py-1.5">SLA</th>
              <th className="text-left px-2 py-1.5">Status</th>
              <th className="text-left px-2 py-1.5">Updated</th>
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
                <td className="px-2 py-1 font-mono text-xs text-[#0066CC]">
                  <Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>
                    {t.number}
                  </Link>
                </td>
                <td className="px-2 py-1 font-medium text-xs max-w-[180px] truncate">{t.subject}</td>
                <td className="px-2 py-1 text-xs max-w-[120px] truncate">{t.customer_name}</td>
                <td className="px-2 py-1 text-xs capitalize">{t.category || "—"}</td>
                <td className="px-2 py-1 text-xs truncate max-w-[100px]">{t.assignee_name || "—"}</td>
                <td className="px-2 py-1 text-xs capitalize">{t.priority}</td>
                <td className="px-2 py-1">
                  <SlaBadge ticket={t} />
                </td>
                <td className="px-2 py-1">
                  <StatusBadge value={t.status} />
                </td>
                <td className="px-2 py-1 font-mono text-[10px] text-slate-500">{fmtDateTime(t.updated_at)}</td>
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
          <form className="space-y-2" onSubmit={handleCreate}>
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
                className="w-full border rounded-md px-2 py-1.5 text-xs min-h-[72px]"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="ticket-priority">
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
                <Label className="text-xs">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="ticket-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta.categories || ["other"]).map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Assignee</Label>
                <Select
                  value={form.assignee_id || "none"}
                  onValueChange={(v) => setForm({ ...form, assignee_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="ticket-assignee">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(meta.assignees || []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Requester email</Label>
              <Input
                className="h-8 text-xs"
                value={form.requester_email}
                onChange={(e) => setForm({ ...form, requester_email: e.target.value })}
              />
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
