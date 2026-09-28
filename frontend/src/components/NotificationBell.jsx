import React, { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bell } from "lucide-react"
import api from "../lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

const POLL_MS = 30000

const relativeTime = (ts) => {
  if (!ts) return ""
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ""
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (sec < 60) return "just now"
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  return `${day}d`
}

export function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const loadCount = useCallback(async () => {
    try {
      const r = await api.get("/notifications/unread-count")
      setCount(Number(r.data?.count || 0))
    } catch {
      /* inbox unreachable — leave the last count */
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get("/notifications", { params: { limit: 30 } })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCount()
    const id = setInterval(loadCount, POLL_MS)
    const onFocus = () => loadCount()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener("focus", onFocus)
    }
  }, [loadCount])

  useEffect(() => {
    if (open) loadList()
  }, [open, loadList])

  const handleItem = async (item) => {
    if (!item.read) {
      try {
        await api.post(`/notifications/${item.id}/read`)
        setCount((c) => Math.max(0, c - 1))
        setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, read: true } : row)))
      } catch {
        /* still open the record */
      }
    }
    setOpen(false)
    if (item.href) navigate(item.href)
  }

  const handleMarkAll = async () => {
    try {
      await api.post("/notifications/read-all")
      setCount(0)
      setItems((rows) => rows.map((row) => ({ ...row, read: true })))
    } catch {
      /* leave the list as loaded */
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="notification-bell"
          aria-label="Notifications"
          className="relative h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        >
          <Bell className="w-4 h-4" />
          {count > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-semibold leading-4 text-center"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-white text-slate-900 border-slate-200 shadow-md">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
          <span className="text-xs font-semibold text-slate-800">Notifications</span>
          <button
            type="button"
            data-testid="notification-mark-all"
            onClick={handleMarkAll}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">Loading</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400" data-testid="notification-empty">
              No notifications
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="notification-item"
              onClick={() => handleItem(item)}
              className="w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 flex gap-2"
            >
              <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${item.read ? "bg-transparent" : "bg-rose-500"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-slate-800 truncate">{item.title}</span>
                {item.body ? <span className="block text-[11px] text-slate-500 truncate">{item.body}</span> : null}
                <span className="block text-[10px] text-slate-400">
                  {[item.actor_name, relativeTime(item.ts)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
