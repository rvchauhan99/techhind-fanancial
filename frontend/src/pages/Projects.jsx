import React, { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDate } from "../lib/format"
import Layout, { Empty, StatusBadge } from "../components/Layout"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

export default function Projects() {
  const { canCap } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [customers, setCustomers] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({
    name: "", description: "", status: "planned", priority: "normal",
    customer_id: "", owner_id: "", due_date: "",
  })

  const load = () => {
    const params = {}
    if (status !== "all") params.status = status
    if (q.trim()) params.q = q.trim()
    api.get("/work/projects", { params }).then((r) => setRows(r.data)).catch(() => setRows([]))
  }

  useEffect(() => { load() }, [status])

  useEffect(() => {
    if (!open) return
    api.get("/customers").then((r) => setCustomers(r.data || [])).catch(() => {})
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
  }, [open])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        ...form,
        customer_id: form.customer_id || null,
        owner_id: form.owner_id || null,
        due_date: form.due_date || null,
      }
      const { data } = await api.post("/work/projects", payload)
      toast.success(`Project ${data.number} created`)
      setOpen(false)
      navigate(`/projects/${data.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Layout
      title="Projects"
      actions={
        <div className="flex items-center gap-2">
          <Input data-testid="projects-search" className="h-8 w-44 text-xs" placeholder="Search…"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load() }} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="projects-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {["planned", "active", "on_hold", "completed", "cancelled"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCap("can_work_write") && (
            <Button size="sm" data-testid="new-project-btn" onClick={() => setOpen(true)}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white h-8">
              <Plus className="w-3.5 h-3.5 mr-1" /> New
            </Button>
          )}
        </div>
      }
    >
      <div className="bg-white border border-slate-200 rounded-lg" data-testid="projects-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Number</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-left px-3 py-2">Owner</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id} data-testid={`project-row-${p.id}`}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate(`/projects/${p.id}`)}>
                <td className="px-3 py-2 font-mono text-xs text-[#0066CC]">{p.number}</td>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{p.customer?.trade_name || p.customer?.legal_name || "—"}</td>
                <td className="px-3 py-2 text-xs">{p.owner?.name || "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={p.status} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDate(p.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No projects" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="project-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Project</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-2.5">
            <div><Label>Name *</Label>
              <Input data-testid="project-name" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Description</Label>
              <Input data-testid="project-desc" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{["planned", "active", "on_hold"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "normal", "high", "urgent"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div><Label>Customer</Label>
              <Select value={form.customer_id || "_none"} onValueChange={(v) => setForm({ ...form, customer_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9" data-testid="project-customer"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Owner</Label>
              <Select value={form.owner_id || "_none"} onValueChange={(v) => setForm({ ...form, owner_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9" data-testid="project-owner"><SelectValue placeholder="Me (default)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Me (default)</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Due date</Label>
              <Input type="date" data-testid="project-due" value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            <Button type="submit" data-testid="project-save" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
