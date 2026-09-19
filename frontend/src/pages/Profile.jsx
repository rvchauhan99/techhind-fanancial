import React, { useState } from "react"
import { ShieldCheck, ShieldOff } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import Layout from "../components/Layout"
import ChangePasswordForm from "../components/ChangePasswordForm"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"

export default function Profile() {
  const { user, setUser, changePassword } = useAuth()
  const [setup, setSetup] = useState(null)
  const [otp, setOtp] = useState("")

  const handlePassword = async ({ currentPassword, newPassword }) => {
    const res = await changePassword(currentPassword, newPassword)
    if (res.error) return res
    toast.success("Password updated")
    return { ok: true }
  }

  const startSetup = async () => {
    try {
      const { data } = await api.post("/auth/2fa/setup")
      setSetup(data)
      setOtp("")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const enable = async (e) => {
    e.preventDefault()
    try {
      await api.post("/auth/2fa/enable", { otp })
      toast.success("2FA enabled")
      setSetup(null)
      setOtp("")
      setUser({ ...user, totp_enabled: true })
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const disable = async () => {
    const code = window.prompt("Enter your current 6-digit code to disable 2FA:")
    if (!code) return
    try {
      await api.post("/auth/2fa/disable", { otp: code })
      toast.success("2FA disabled")
      setUser({ ...user, totp_enabled: false })
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <Layout title="My Profile">
      <div className="grid gap-4 md:grid-cols-2 max-w-4xl" data-testid="profile-page">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Profile</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
              {(user?.name || "?").split(" ").map((x) => x[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900" data-testid="profile-name">{user?.name}</div>
              <div className="text-xs text-slate-500" data-testid="profile-email">{user?.email}</div>
              <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-px bg-slate-50 text-slate-600" data-testid="profile-role">
                {user?.role}
              </span>
            </div>
          </div>
          {(user?.department || user?.title) && (
            <div className="text-xs text-slate-500 space-y-0.5">
              {user?.title && <div>Title: {user.title}</div>}
              {user?.department && <div>Department: {user.department}</div>}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="profile-2fa">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            {user?.totp_enabled
              ? <ShieldCheck className="w-4 h-4 text-emerald-600" />
              : <ShieldOff className="w-4 h-4 text-slate-400" />}
            Authenticator (2FA)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Status: {user?.totp_enabled
              ? <b className="text-emerald-700">Enabled</b>
              : "Disabled"} — Google Authenticator, Authy, 1Password, etc.
          </p>
          {!user?.totp_enabled && !setup && (
            <Button data-testid="2fa-setup-btn" size="sm" className="mt-3 bg-[#0F284E] hover:bg-[#17386D] text-white" onClick={startSetup}>
              Enable 2FA
            </Button>
          )}
          {setup && (
            <form onSubmit={enable} className="mt-3 space-y-3 border border-slate-200 rounded-md p-3">
              <p className="text-xs text-slate-600">1. Scan this QR with your authenticator app.</p>
              {setup.qr_data_url && (
                <img
                  src={setup.qr_data_url}
                  alt="2FA QR code"
                  data-testid="2fa-qr"
                  className="border border-slate-200 rounded p-1 w-40 h-40 bg-white"
                />
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Secret (manual)</div>
                <div className="font-mono text-sm font-bold mt-0.5" data-testid="2fa-secret">{setup.secret}</div>
              </div>
              <div>
                <Label>2. Enter 6-digit code</Label>
                <Input
                  data-testid="2fa-enable-code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="font-mono tracking-[0.4em] w-40 mt-1"
                />
              </div>
              <Button data-testid="2fa-enable-btn" type="submit" size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
                Verify &amp; Enable
              </Button>
            </form>
          )}
          {user?.totp_enabled && (
            <Button
              data-testid="2fa-disable-btn"
              size="sm"
              variant="outline"
              className="mt-3 text-red-600 border-red-200 hover:bg-red-50"
              onClick={disable}
            >
              Disable 2FA
            </Button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 md:col-span-2 max-w-md">
          <ChangePasswordForm
            onSubmit={handlePassword}
            title="Change password"
            subtitle="Update your sign-in password."
            submitLabel="Update password"
            testId="profile-change-password"
          />
        </div>
      </div>
    </Layout>
  )
}
