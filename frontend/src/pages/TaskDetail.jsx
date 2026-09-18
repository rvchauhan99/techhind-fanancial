import React, { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDate } from "../lib/format"
import Layout, { StatusBadge } from "../components/Layout"
import WorkActivity from "../components/WorkActivity"
import { useAuth } from "../context/AuthContext"
import { Label } from "../components/ui/label"
import { Input } from "../components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canCap } = useAuth()
  const [task, setTask] = useState(null)
  const [users, setUsers] = useState([])
  const [categories, setCategories] = useState([])

  const load = () => {
    api.get(`/work/tasks/${id}`).then((r) => setTask(r.data)).catch(() => setTask(null))
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
    api.get("/work/categories").then((r) => setCategories(r.data || [])).catch(() => {})
  }, [])

  const patch = async (body) => {
    try {
      const { data } = await api.patch(`/work/tasks/${id}`, body)
      setTask(data)
      toast.success("Task updated")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  if (!task) {
    return <Layout title="Task"><div className="text-sm text-slate-500">Loading…</div></Layout>
  }

  return (
    <Layout
      title={task.title}
      actions={
        <button data-testid="back-tasks" onClick={() => navigate("/tasks")}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      }
    >
      <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="task-header">
        <div className="font-mono text-xs text-[#0066CC]">{task.number}</div>
        <h2 className="font-heading text-lg font-bold text-slate-900 mt-0.5">{task.title}</h2>
        <p className="text-xs text-slate-500 mt-1">{task.description || "No description"}</p>
        {task.project && (
          <div className="mt-2 text-xs">
            Project:{" "}
            <Link to={`/projects/${task.project.id}`} className="text-[#0066CC] font-medium">
              {task.project.number} — {task.project.name}
            </Link>
          </div>
        )}

        {canCap("can_work_write") ? (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px]">Status</Label>
              <Select value={task.status} onValueChange={(v) => patch({ status: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="task-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["todo", "in_progress", "blocked", "done", "cancelled"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Priority</Label>
              <Select value={task.priority} onValueChange={(v) => patch({ priority: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "normal", "high", "urgent"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Category</Label>
              <Select value={task.category} onValueChange={(v) => patch({ category: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="task-category-edit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(categories.length ? categories.map((c) => c.name) : [task.category]).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Assignee</Label>
              <Select
                value={task.assignee_id || "_none"}
                onValueChange={(v) => patch({ assignee_id: v === "_none" ? null : v })}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="task-assignee-edit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Due date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                data-testid="task-due-edit"
                value={task.due_date || ""}
                onChange={(e) => patch({ due_date: e.target.value || null })}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-3 items-center text-xs">
            <StatusBadge value={task.status} />
            <span className="uppercase text-slate-500">{task.priority}</span>
            <span className="capitalize">{task.category}</span>
            <span>{task.assignee?.name || "Unassigned"}</span>
            <span className="font-mono">{fmtDate(task.due_date)}</span>
          </div>
        )}
      </div>

      <WorkActivity entityType="task" entityId={id} />
    </Layout>
  )
}
