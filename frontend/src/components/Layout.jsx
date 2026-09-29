import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { NavLink, useNavigate, useLocation } from "react-router-dom"
import {
  LayoutDashboard, FileText, ReceiptIndianRupee, Building2, Repeat, Package,
  Briefcase, Wallet, CalendarClock, ShieldCheck, Settings, LogOut, ClockAlert,
  Layers3, Lock, FolderArchive, Upload, LifeBuoy, FolderKanban, ListTodo,
  BarChart3, Users, Circle, Landmark, Menu,
} from "lucide-react"
import api from "../lib/api"
import { fmtINR } from "../lib/format"
import { useAuth } from "../context/AuthContext"
import { NotificationBell } from "./NotificationBell"
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet"
import { labelPwaTables } from "../lib/pwaTable"

const ICON_MAP = {
  LayoutDashboard,
  FileText,
  ReceiptIndianRupee,
  Building2,
  Repeat,
  Package,
  Briefcase,
  Wallet,
  CalendarClock,
  ShieldCheck,
  Settings,
  Lock,
  FolderArchive,
  Upload,
  LifeBuoy,
  FolderKanban,
  ListTodo,
  BarChart3,
  Users,
  Circle,
  Landmark,
}

const FALLBACK_NAV = [
  { section: "Core", items: [
    { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard", tid: "nav-dashboard", key: "dashboard" },
    { name: "Support Tickets", icon: LifeBuoy, path: "/tickets", tid: "nav-tickets", key: "tickets" },
  ] },
  {
    section: "Revenue & GST",
    items: [
      { name: "Invoices & Notes", icon: FileText, path: "/invoices", tid: "nav-invoices", key: "invoices" },
      { name: "Payments & Receipts", icon: ReceiptIndianRupee, path: "/payments", tid: "nav-payments", key: "payments" },
      { name: "Customers 360", icon: Building2, path: "/customers", tid: "nav-customers", key: "customers" },
      { name: "Subscriptions", icon: Repeat, path: "/subscriptions", tid: "nav-subscriptions", key: "subscriptions" },
      { name: "Products & Plans", icon: Package, path: "/products", tid: "nav-products", key: "products" },
    ],
  },
  {
    section: "Payables & Expenses",
    items: [
      { name: "Vendors & Bills", icon: Briefcase, path: "/vendors", tid: "nav-vendors", key: "vendors" },
      { name: "Expense Vouchers", icon: Wallet, path: "/expenses", tid: "nav-expenses", key: "expenses" },
      { name: "Bank Ledger", icon: Landmark, path: "/banks", tid: "nav-banks", key: "banks" },
      { name: "AR / AP Aging", icon: CalendarClock, path: "/aging", tid: "nav-aging", key: "aging" },
    ],
  },
  {
    section: "Governance",
    items: [
      { name: "Period Close", icon: Lock, path: "/period-close", tid: "nav-period-close", key: "period_close" },
      { name: "Accountant Pack", icon: FolderArchive, path: "/accountant-pack", tid: "nav-accountant-pack", key: "accountant_pack" },
      { name: "CSV Import", icon: Upload, path: "/imports", tid: "nav-imports", key: "imports" },
      { name: "Audit Trail", icon: ShieldCheck, path: "/audit", tid: "nav-audit", key: "audit" },
      { name: "Settings & Masters", icon: Settings, path: "/settings", tid: "nav-settings", key: "settings" },
    ],
  },
]

const ROLE_BADGE = {
  admin: "bg-red-500/15 text-red-300 border-red-400/30",
  accountant: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  ops: "bg-blue-500/15 text-blue-300 border-blue-400/30",
  viewer: "bg-slate-500/15 text-slate-300 border-slate-400/30",
  developer: "bg-violet-500/15 text-violet-300 border-violet-400/30",
  project_manager: "bg-cyan-500/15 text-cyan-300 border-cyan-400/30",
  qa: "bg-orange-500/15 text-orange-300 border-orange-400/30",
  trainer: "bg-pink-500/15 text-pink-300 border-pink-400/30",
  sales: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  support_agent: "bg-teal-500/15 text-teal-300 border-teal-400/30",
  hr: "bg-slate-500/15 text-slate-300 border-slate-400/30",
  freelancer: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/30",
}

function buildNavFromMenus(menus) {
  if (!menus?.length) return null
  const bySection = {}
  for (const m of menus) {
    const section = m.section || "Core"
    if (!bySection[section]) bySection[section] = []
    const Icon = ICON_MAP[m.icon] || Circle
    bySection[section].push({
      name: m.label,
      icon: Icon,
      path: m.path,
      tid: `nav-${m.key}`,
      key: m.key,
    })
  }
  return Object.entries(bySection).map(([section, items]) => ({ section, items }))
}

function ActionStrips() {
  const [renewals, setRenewals] = useState(null)
  const [queue, setQueue] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { hasMenu, menus } = useAuth()
  const showFinance = !menus?.length || hasMenu("invoices") || hasMenu("subscriptions")

  useEffect(() => {
    if (!showFinance) return
    (async () => {
      try {
        const [r, q] = await Promise.all([api.get("/subscriptions/renewals"), api.get("/queue")])
        setRenewals(r.data)
        setQueue(q.data)
      } catch {}
    })()
  }, [location.pathname, showFinance])

  if (!showFinance) return null

  const buckets = [
    { key: "overdue", label: "Overdue", cls: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500" },
    { key: "in_7_days", label: "≤ 7 days", cls: "text-amber-800 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
    { key: "in_15_days", label: "≤ 15 days", cls: "text-blue-800 bg-blue-50 border-blue-200", dot: "bg-blue-500" },
    { key: "in_30_days", label: "≤ 30 days", cls: "text-slate-700 bg-slate-100 border-slate-200", dot: "bg-slate-400" },
  ]

  return (
    <div data-testid="action-strips" className="h-9 md:h-11 bg-slate-50 border-b border-slate-200 px-3 md:px-6 flex items-center justify-between gap-4 overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0" data-testid="nearby-renewals-strip">
        <ClockAlert className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">Renewals</span>
        {buckets.map((b) => (
          <button
            key={b.key}
            data-testid={`renewals-bucket-${b.key}`}
            onClick={() => navigate(`/subscriptions?bucket=${b.key}`)}
            className={`flex items-center gap-1.5 border rounded px-2 py-0.5 text-xs font-semibold transition-transform hover:-translate-y-px ${b.cls}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} />
            {b.label}
            <span className="font-mono font-bold">{renewals ? renewals.counts[b.key] : "–"}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 shrink-0" data-testid="operational-queue-strip">
        <Layers3 className="w-4 h-4 text-slate-500 shrink-0" />
        <button data-testid="queue-drafts" onClick={() => navigate("/invoices?status=draft")}
          className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded px-2 py-0.5 transition-colors">
          Drafts <span className="font-mono font-bold">{queue ? queue.draft_invoices : "–"}</span>
        </button>
        <button data-testid="queue-pending-vouchers" onClick={() => navigate("/expenses?status=pending_approval")}
          className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded px-2 py-0.5 transition-colors">
          Vouchers to approve <span className="font-mono font-bold">{queue ? queue.pending_vouchers : "–"}</span>
        </button>
        <button data-testid="queue-overdue-invoices" onClick={() => navigate("/aging")}
          className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded px-2 py-0.5 transition-colors">
          Overdue invoices <span className="font-mono font-bold">{queue ? queue.overdue_invoices : "–"}</span>
        </button>
        <span className="text-xs text-slate-600 border border-slate-200 bg-white rounded px-2 py-0.5">
          Unallocated <span className="font-mono font-bold">{queue ? fmtINR(queue.unallocated_receipts) : "–"}</span>
        </span>
      </div>
    </div>
  )
}

const PHONE_TABS = [
  { key: "dashboard", label: "Home", icon: LayoutDashboard, path: "/dashboard", tid: "tab-home" },
  { key: "tickets", label: "Tickets", icon: LifeBuoy, path: "/tickets", tid: "tab-tickets" },
  { key: "invoices", label: "Invoices", icon: FileText, path: "/invoices", tid: "tab-invoices" },
  { key: "tasks", label: "Tasks", icon: ListTodo, path: "/tasks", tid: "tab-tasks" },
]

function NavSections({ nav, onNavigate, idSuffix = "" }) {
  return nav.map((sec) => (
    <div key={sec.section}>
      <div className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{sec.section}</div>
      <div className="space-y-0.5">
        {sec.items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            data-testid={`${item.tid}${idSuffix}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors min-h-9 ${
                isActive ? "bg-[#0066CC] text-white" : "hover:bg-slate-800/70 hover:text-white"
              }`
            }
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.name}
          </NavLink>
        ))}
      </div>
    </div>
  ))
}

function UserFooter({ user, onProfile, onLogout, compact = false }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? "" : ""}`}>
      <button
        type="button"
        data-testid={compact ? "nav-profile-mobile" : "nav-profile"}
        onClick={onProfile}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left rounded hover:bg-slate-800/70 p-0.5 -m-0.5 transition-colors min-h-11"
        title="My profile"
      >
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
          {(user?.name || "?").split(" ").map((x) => x[0]).slice(0, 2).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white truncate" data-testid={compact ? "user-name-mobile" : "user-name"}>{user?.name}</div>
          <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-px ${ROLE_BADGE[user?.role] || "bg-slate-500/15 text-slate-300 border-slate-400/30"}`} data-testid={compact ? "user-role-badge-mobile" : "user-role-badge"}>
            {user?.role}
          </span>
        </div>
      </button>
      <button
        type="button"
        data-testid={compact ? "logout-btn-mobile" : "logout-btn"}
        aria-label="Sign out"
        onClick={onLogout}
        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors min-h-11 min-w-11 flex items-center justify-center"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function Layout({ children, title, actions }) {
  const { user, logout, menus, hasMenu } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const shellRef = useRef(null)
  const [navOpen, setNavOpen] = useState(false)
  const nav = buildNavFromMenus(menus) || FALLBACK_NAV
  const phoneTabs = PHONE_TABS.filter((tab) => !menus?.length || hasMenu(tab.key))

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useLayoutEffect(() => {
    const root = shellRef.current
    if (!root) return undefined
    let timer = 0
    const flush = () => labelPwaTables(root)
    const run = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, 0)
    }
    flush()
    const observer = new MutationObserver(run)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    navigate("/login")
  }

  return (
    <div ref={shellRef} className="flex h-screen bg-[#F8FAFC] overflow-hidden">
      <aside className="hidden md:flex w-60 shrink-0 bg-[#0B192C] text-slate-300 flex-col">
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-slate-800">
          <div className="w-7 h-7 rounded bg-[#0066CC] flex items-center justify-center text-white font-bold text-sm font-heading">TH</div>
          <div>
            <div className="text-sm font-bold text-white font-heading tracking-tight leading-tight">TechHind Finance</div>
            <div className="text-[10px] text-slate-500 leading-tight">Single-company ERP</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4" data-testid="sidebar-nav">
          <NavSections nav={nav} />
        </nav>
        <div className="p-3 border-t border-slate-800">
          <UserFooter user={user} onProfile={() => navigate("/profile")} onLogout={handleLogout} />
        </div>
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          data-testid="mobile-drawer"
          className="md:hidden w-[min(100%,18rem)] max-w-none bg-[#0B192C] text-slate-300 border-slate-800 p-0 gap-0 flex flex-col"
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="h-14 flex items-center gap-2.5 px-5 border-b border-slate-800 pt-[env(safe-area-inset-top)]">
            <div className="w-7 h-7 rounded bg-[#0066CC] flex items-center justify-center text-white font-bold text-sm font-heading">TH</div>
            <div className="text-sm font-bold text-white font-heading tracking-tight">TechHind Finance</div>
          </div>
          <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4" data-testid="mobile-nav">
            <NavSections nav={nav} onNavigate={() => setNavOpen(false)} idSuffix="-mobile" />
          </nav>
          <div className="p-3 border-t border-slate-800 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <UserFooter
              compact
              user={user}
              onProfile={() => { setNavOpen(false); navigate("/profile") }}
              onLogout={handleLogout}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
          <div className="h-12 md:h-14 px-3 md:px-6 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                data-testid="mobile-menu-btn"
                aria-label="Open menu"
                className="md:hidden min-h-11 min-w-11 -ml-1 inline-flex items-center justify-center rounded text-slate-700"
                onClick={() => setNavOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-base md:text-lg font-bold tracking-tight text-slate-900 font-heading truncate" data-testid="page-title">{title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <NotificationBell />
              <div className="hidden md:flex items-center gap-2">{actions}</div>
            </div>
          </div>
        </header>
        <ActionStrips />
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="max-w-[1720px] mx-auto space-y-3 md:space-y-6">{children}</div>
        </main>
        {actions ? (
          <div
            data-testid="mobile-action-bar"
            className="md:hidden shrink-0 bg-white border-t border-slate-200 px-2 py-1.5 flex items-center gap-2 overflow-x-auto"
          >
            {actions}
          </div>
        ) : null}
        <nav
          data-testid="mobile-tabbar"
          className="md:hidden shrink-0 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]"
        >
          {phoneTabs.map((tab) => {
            const active = location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`)
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.key}
                to={tab.path}
                data-testid={tab.tid}
                className={`flex-1 min-h-11 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                  active ? "text-[#0066CC]" : "text-slate-500"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </NavLink>
            )
          })}
          <button
            type="button"
            data-testid="tab-more"
            aria-label="More"
            className="flex-1 min-h-11 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-slate-500"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="w-4 h-4" />
            More
          </button>
        </nav>
      </div>
    </div>
  )
}

export function StatusBadge({ value }) {
  const { STATUS_STYLES, STATUS_LABELS } = require("../lib/format")
  return (
    <span data-testid={`status-${value}`} className={`inline-block text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_STYLES[value] || STATUS_STYLES.draft}`}>
      {STATUS_LABELS[value] || value}
    </span>
  )
}

export function Empty({ label }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-400" data-testid="empty-state">{label}</div>
}
