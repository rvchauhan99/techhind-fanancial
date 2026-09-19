import React, { useState } from "react"
import { Lock, KeyRound } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"

/** Forced / voluntary password change form. */
export default function ChangePasswordForm({
  onSubmit,
  title = "Set a new password",
  subtitle = "You must change your temporary password before continuing.",
  submitLabel = "Save password",
  requireCurrent = true,
  testId = "change-password-form",
}) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match")
      return
    }
    if (requireCurrent && currentPassword && newPassword === currentPassword) {
      setError("New password must be different from current password")
      return
    }
    setBusy(true)
    const res = await onSubmit({ currentPassword, newPassword })
    setBusy(false)
    if (res?.error) {
      setError(res.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4" data-testid={testId}>
      <div>
        <h2 className="font-heading text-xl font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {error && (
        <div data-testid="change-password-error" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {requireCurrent && (
        <div className="space-y-1.5">
          <Label htmlFor="cp-current">Current password</Label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              id="cp-current"
              data-testid="cp-current-input"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="cp-new">New password</Label>
        <div className="relative">
          <KeyRound className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <Input
            id="cp-new"
            data-testid="cp-new-input"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cp-confirm">Confirm new password</Label>
        <Input
          id="cp-confirm"
          data-testid="cp-confirm-input"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      <Button
        data-testid="cp-submit-btn"
        type="submit"
        disabled={busy}
        className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white"
      >
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  )
}
