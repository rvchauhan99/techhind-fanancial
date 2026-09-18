import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
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

export default function Tasks() {
  const { canCap, user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState("all")
  const [scope, setScope] = useState("mine")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({
    title: "", category: "development", priority: "normal",
    project_id: "", assignee_id: "", due_date: "",
  })

  const load = () => {
    const params = {}
    if (status !== "all") params.status = status
    if (scope === "mine") params.mine = true
    if (q.trim()) params.q = q.trim()
    api.get("/work/tasks", { params }).then((r) => setRows(r.data)).catch(() => setRows([]))
  }

  useEffect(() => { load() }, [status, scope])

  useEffect(() => {
    if (!open) return
    api.get("/work/projects").then((r) => setProjects(r.data || [])).catch(() => {})
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
    api.get("/work/categories").then((r) => setCategories(r.data || [])).catch(() => {})
    setForm((f) => ({ ...f, assignee_id: user?.id || "" }))
  }, [open, user?.id])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post("/work/tasks", {
        ...form,
        project_id: form.project_id || null,
        assignee_id: form.assignee_id || null,
        due_date: form.due_date || null,
      })
      toast.success(`Task ${data.number} created`)
      setOpen(false)
      navigate(`/tasks/${data.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Layout
      title="My Work"
      actions={
        <div className="flex items-center gap-2">
          <Input data-testid="tasks-search" className="h-8 w-40 text-xs" placeholder="Search…"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load() }} />
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="h-8 w-28 text-xs" data-testid="tasks-scope"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Assigned to me</SelectItem>
              <SelectItem value="all">All tasks</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="tasks-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {["todo", "in_progress", "blocked", "done", "cancelled"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCap("can_work_write") && (
            <Button size="sm" data-testid="new-task-btn" onClick={() => setOpen(true)}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white h-8">
              <Plus className="w-3.5 h-3.5 mr-1" /> New
            </Button>
          )}
        </div>
      }
    >
      <div className="bg-white border border-slate-200 rounded-lg" data-testid="tasks-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Number</th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Project</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Assignee</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((t) => (
              <tr key={t.id} data-testid={`task-row-${t.id}`}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate(`/tasks/${t.id}`)}>
                <td className="px-3 py-2 font-mono text-xs text-[#0066CC]">{t.number}</td>
                <td className="px-3 py-2 font-medium">{t.title}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{t.project?.name || "—"}</td>
                <td className="px-3 py-2 text-xs capitalize">{t.category}</td>
                <td className="px-3 py-2 text-xs">{t.assignee?.name || "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={t.status} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDate(t.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No tasks" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="task-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Task</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-2.5">
            <div><Label>Title *</Label>
              <Input required data-testid="task-title-input" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Project</Label>
              <Select value={form.project_id || "_none"} onValueChange={(v) => setForm({ ...form, project_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="h-9" data-testid="task-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(categories.length ? categories.map((c) => c.name) : ["other"]).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "normal", "high", "urgent"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div><Label>Assignee</Label>
              <Select value={form.assignee_id || "_none"} onValueChange={(v) => setForm({ ...form, assignee_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9" data-testid="task-assignee-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            <Button type="submit" data-testid="task-save" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
