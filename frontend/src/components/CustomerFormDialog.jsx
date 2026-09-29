import React, { useEffect, useState } from "react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { INDIAN_STATES } from "../lib/format"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

export const emptyCustomerForm = {
  legal_name: "",
  trade_name: "",
  gstin: "",
  pan: "",
  state: "",
  state_code: "",
  billing_address: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  crm_tenant_key: "",
  notes: "",
}

export const customerToForm = (c) => {
  const contact = (c?.contacts || [])[0] || {}
  return {
    legal_name: c?.legal_name || "",
    trade_name: c?.trade_name || "",
    gstin: c?.gstin || "",
    pan: c?.pan || "",
    state: c?.state || "",
    state_code: c?.state_code || "",
    billing_address: c?.billing_address || "",
    contact_name: contact.name || "",
    contact_email: contact.email || "",
    contact_phone: contact.phone || "",
    crm_tenant_key: c?.crm_tenant_key || "",
    notes: c?.notes || "",
  }
}

const buildPayload = (form) => ({
  legal_name: form.legal_name,
  trade_name: form.trade_name,
  gstin: form.gstin,
  pan: form.pan,
  state: form.state,
  state_code: form.state_code,
  billing_address: form.billing_address,
  notes: form.notes,
  crm_tenant_key: form.crm_tenant_key,
  contacts: [{ name: form.contact_name, email: form.contact_email, phone: form.contact_phone }],
})

/**
 * Shared create/edit dialog for Customer master.
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, customer?: object | null, onSaved?: (doc: object) => void }} props
 */
export default function CustomerFormDialog({ open, onOpenChange, customer = null, onSaved }) {
  const editingId = customer?.id || null
  const [form, setForm] = useState(emptyCustomerForm)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(customer ? customerToForm(customer) : emptyCustomerForm)
  }, [open, editingId]) // eslint-disable-line react-hooks/exhaustive-deps -- reset when dialog opens / target id changes

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = buildPayload(form)
      let doc
      if (editingId) {
        const res = await api.patch(`/customers/${editingId}`, payload)
        doc = res.data
        toast.success("Customer updated")
      } else {
        const res = await api.post("/customers", payload)
        doc = res.data
        toast.success("Customer created")
      }
      onOpenChange(false)
      if (onSaved) onSaved(doc)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white" data-testid="customer-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{editingId ? "Edit Customer" : "New Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Legal name *</Label>
            <Input
              data-testid="customer-legal-name-input"
              required
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            />
          </div>
          <div>
            <Label>Trade name</Label>
            <Input value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
          </div>
          <div>
            <Label>GSTIN</Label>
            <Input
              data-testid="customer-gstin-input"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              className="font-mono"
            />
          </div>
          <div className="col-span-2">
            <Label>State (place of supply) *</Label>
            <Select
              value={form.state_code}
              onValueChange={(v) => {
                const s = INDIAN_STATES.find(([c]) => c === v)
                setForm({ ...form, state_code: v, state: s ? s[1] : "" })
              }}
            >
              <SelectTrigger data-testid="customer-state-select">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent className="bg-white max-h-64">
                {INDIAN_STATES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Billing address</Label>
            <Input
              value={form.billing_address}
              onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
            />
          </div>
          <div>
            <Label>Contact name</Label>
            <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          </div>
          <div>
            <Label>Contact email</Label>
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
          <div>
            <Label>Contact phone</Label>
            <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <div>
            <Label>Solar tenant key (crm_tenant_key)</Label>
            <Input
              value={form.crm_tenant_key}
              onChange={(e) => setForm({ ...form, crm_tenant_key: e.target.value })}
              className="font-mono"
              placeholder="Must match Solar tenant_key for support bridge"
            />
            <p className="text-[10px] text-slate-500 mt-0.5">
              Required for Solar support tickets. Set to the tenant&apos;s Solar tenant_key — unmatched creates return 422.
            </p>
          </div>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              data-testid="customer-save-btn"
              type="submit"
              disabled={busy}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white"
            >
              {busy ? "Saving…" : editingId ? "Update Customer" : "Create Customer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
