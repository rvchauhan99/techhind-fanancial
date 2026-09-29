import React, { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Plus } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDate } from "../lib/format"
import Layout, { Empty, StatusBadge } from "../components/Layout"
import WorkActivity from "../components/WorkActivity"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canCap } = useAuth()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [categories, setCategories] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    title: "", category: "development", priority: "normal", assignee_id: "", due_date: "",
  })

  const load = () => {
    api.get(`/work/projects/${id}`).then((r) => setProject(r.data)).catch(() => setProject(null))
    api.get("/work/tasks", { params: { project_id: id } }).then((r) => setTasks(r.data || [])).catch(() => setTasks([]))
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
    api.get("/work/categories").then((r) => setCategories(r.data || [])).catch(() => {})
  }, [])

  const patch = async (body) => {
    try {
      const { data } = await api.patch(`/work/projects/${id}`, body)
      setProject(data)
      toast.success("Project updated")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post("/work/tasks", {
        ...form,
        project_id: id,
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

  if (!project) {
    return <Layout title="Project"><div className="text-sm text-slate-500">Loading…</div></Layout>
  }

  return (
    <Layout
      title={project.name}
      actions={
        <div className="flex items-center gap-2">
          {canCap("can_work_write") && (
            <Button size="sm" data-testid="project-add-task" onClick={() => setOpen(true)}
              className="h-8 bg-[#0F284E] hover:bg-[#17386D] text-white">
              <Plus className="w-3.5 h-3.5 mr-1" /> Task
            </Button>
          )}
          <button data-testid="back-projects" onClick={() => navigate("/projects")}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        </div>
      }
    >
      <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="project-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-[#0066CC]">{project.number}</div>
            <h2 className="font-heading text-lg font-bold text-slate-900">{project.name}</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">{project.description || "No description"}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Owner: {project.owner?.name || "—"}</span>
              <span>Customer: {project.customer ? (
                <Link to={`/customers/${project.customer.id}`} className="text-[#0066CC]">{project.customer.trade_name || project.customer.legal_name}</Link>
              ) : "—"}</span>
              <span>Due: {fmtDate(project.due_date)}</span>
            </div>
          </div>
          {canCap("can_work_write") && (
            <div className="flex gap-2">
              <Select value={project.status} onValueChange={(v) => patch({ status: v })}>
                <SelectTrigger className="h-8 w-32 text-xs" data-testid="project-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["planned", "active", "on_hold", "completed", "cancelled"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={project.priority} onValueChange={(v) => patch({ priority: v })}>
                <SelectTrigger className="h-8 w-28 text-xs" data-testid="project-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "normal", "high", "urgent"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!canCap("can_work_write") && (
            <div className="flex gap-2 items-center">
              <StatusBadge value={project.status} />
              <span className="text-xs uppercase text-slate-500">{project.priority}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="project-tasks">
        <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold">Tasks</div>
        <table className="w-full text-sm pwa-table">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Number</th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Assignee</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate(`/tasks/${t.id}`)}>
                <td className="px-3 py-2 font-mono text-xs text-[#0066CC]">{t.number}</td>
                <td className="px-3 py-2">{t.title}</td>
                <td className="px-3 py-2 text-xs capitalize">{t.category}</td>
                <td className="px-3 py-2 text-xs">{t.assignee?.name || "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={t.status} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDate(t.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tasks.length && <Empty label="No tasks on this project" />}
      </div>

      <WorkActivity entityType="project" entityId={id} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="task-from-project-dialog">
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateTask} className="space-y-2.5">
            <div><Label>Title *</Label>
              <Input required data-testid="task-title" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(categories.length ? categories.map((c) => c.name) : ["development", "other"]).map((c) => (
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
                <SelectTrigger className="h-9" data-testid="task-assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Due</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            <Button type="submit" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create task</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
