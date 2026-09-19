import React, { useEffect, useState } from "react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import Layout, { Empty } from "../components/Layout"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Checkbox } from "../components/ui/checkbox"

const CAP_KEYS = [
  "can_finance_write",
  "can_finance_admin",
  "can_finance_audit",
  "can_work_write",
  "can_work_manage",
  "can_rbac_admin",
  "can_ticket_write",
]

export default function Roles() {
  const { canCap, refreshRbac } = useAuth()
  const [roles, setRoles] = useState(null)
  const [menus, setMenus] = useState([])
  const [selected, setSelected] = useState("")
  const [menuKeys, setMenuKeys] = useState([])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const [r, m] = await Promise.all([
        api.get("/rbac/roles"),
        api.get("/rbac/menus"),
      ])
      setRoles(r.data || [])
      setMenus(m.data || [])
      if (!selected && r.data?.[0]) setSelected(r.data[0].key)
    } catch (e) {
      toast.error(apiError(e))
      setRoles([])
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!selected) return
    api.get(`/rbac/roles/${selected}/menus`)
      .then((r) => setMenuKeys(r.data.menu_keys || []))
      .catch(() => setMenuKeys([]))
  }, [selected])

  if (!canCap("can_rbac_admin")) {
    return (
      <Layout title="Roles & Access">
        <div className="text-sm text-slate-500" data-testid="roles-forbidden">Insufficient permission</div>
      </Layout>
    )
  }

  const toggleMenu = (key) => {
    setMenuKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const saveMenus = async () => {
    setSaving(true)
    try {
      await api.put(`/rbac/roles/${selected}/menus`, { menu_keys: menuKeys })
      toast.success("Role menus updated")
      await refreshRbac()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  const patchCap = async (roleKey, cap, value) => {
    try {
      await api.patch(`/rbac/roles/${roleKey}`, { [cap]: value })
      toast.success("Capability updated")
      load()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const sections = [...new Set(menus.map((m) => m.section))]

  return (
    <Layout
      title="Roles & Access"
      actions={
        <Button data-testid="roles-save-menus" size="sm" disabled={saving || !selected}
          onClick={saveMenus} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
          Save menu access
        </Button>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="roles-table">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold">Org roles</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-2 py-1.5">Key</th>
                  <th className="text-left px-2 py-1.5">Name</th>
                  {CAP_KEYS.map((c) => (
                    <th key={c} className="text-center px-1 py-1.5" title={c}>{c.replace("can_", "").slice(0, 6)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(roles || []).map((r) => (
                  <tr
                    key={r.key}
                    data-testid={`role-row-${r.key}`}
                    onClick={() => setSelected(r.key)}
                    className={`border-t border-slate-100 cursor-pointer ${selected === r.key ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-2 py-1.5 font-mono text-xs">{r.key}</td>
                    <td className="px-2 py-1.5 text-xs font-medium">{r.name}</td>
                    {CAP_KEYS.map((c) => (
                      <td key={c} className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean(r[c])}
                          onCheckedChange={(v) => patchCap(r.key, c, Boolean(v))}
                          data-testid={`cap-${r.key}-${c}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {roles && !roles.length && <Empty label="No roles" />}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg" data-testid="role-menus-panel">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold flex items-center justify-between">
            <span>Menus for <span className="font-mono text-[#0066CC]">{selected || "—"}</span></span>
          </div>
          <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
            {sections.map((sec) => (
              <div key={sec}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{sec}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {menus.filter((m) => m.section === sec).map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-xs border border-slate-100 rounded px-2 py-1.5 hover:bg-slate-50">
                      <Checkbox
                        checked={menuKeys.includes(m.key)}
                        onCheckedChange={() => toggleMenu(m.key)}
                        data-testid={`menu-check-${m.key}`}
                      />
                      <span>{m.label}</span>
                      <span className="font-mono text-[10px] text-slate-400 ml-auto">{m.path}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!menus.length && <Empty label="No menus seeded" />}
          </div>
        </div>
      </div>
    </Layout>
  )
}
