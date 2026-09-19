import React, { useState, useEffect } from "react";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, Lock, Mail, KeyRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { API_CONFIG_ERROR } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Login() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "config" || API_CONFIG_ERROR) {
      setError("API URL is not configured. Set REACT_APP_BACKEND_URL and redeploy.");
    }
  }, [searchParams]);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await login(email, password, otp);
    setBusy(false);
    if (res.requires2fa) {
      setNeeds2fa(true);
      return;
    }
    if (res.error) {
      setError(res.error);
      return;
    }
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      <div className="hidden lg:flex w-[46%] bg-[#0B192C] text-white flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[#0066CC] flex items-center justify-center font-bold font-heading">TH</div>
          <span className="font-heading font-bold text-lg tracking-tight">TechHind Pvt Ltd</span>
        </div>
        <div>
          <h1 className="font-heading text-4xl font-bold tracking-tight leading-tight" data-testid="login-hero-title">
            Company finance,<br />run with precision.
          </h1>
          <p className="mt-4 text-slate-400 text-sm leading-relaxed max-w-md">
            SaaS revenue, GST invoicing, subscriptions &amp; renewals, AR/AP, expenses and audit —
            one internal workspace for TechHind.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-xs text-slate-400">
            {["GST-compliant invoicing", "TH/{FY} number series", "Immutable audit trail"].map((t) => (
              <div key={t} className="border border-slate-800 rounded-md p-3 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0066CC] shrink-0 mt-0.5" />{t}
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-slate-600">FY Apr–Mar · INR · GSTIN 24AAACT2728Q1ZW</div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 bg-white border border-slate-200 rounded-xl p-8 shadow-sm" data-testid="login-form">
          <div>
            <h2 className="font-heading text-2xl font-bold tracking-tight text-slate-900">Sign in</h2>
            <p className="text-sm text-slate-500 mt-1">Use your TechHind Finance credentials</p>
          </div>
          {error && (
            <div data-testid="login-error" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
          )}
          {!needs2fa ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <Input id="email" data-testid="login-email-input" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="you@techhind.in" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <Input id="password" data-testid="login-password-input" type="password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} className="pl-9" placeholder="••••••••" />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="otp">Two-factor code</Label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <Input id="otp" data-testid="login-otp-input" inputMode="numeric" maxLength={6} required value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="pl-9 font-mono tracking-[0.4em]" placeholder="000000" />
              </div>
              <p className="text-xs text-slate-500">Enter the 6-digit code from your authenticator app.</p>
            </div>
          )}
          <Button data-testid="login-submit-button" type="submit" disabled={busy || API_CONFIG_ERROR}
            className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white transition-colors">
            {busy ? "Signing in…" : needs2fa ? "Verify & sign in" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
