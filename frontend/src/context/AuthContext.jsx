import React, { createContext, useContext, useEffect, useState, useCallback } from "react"
import api, { setToken, apiError, API_CONFIG_ERROR } from "../lib/api"

const AuthContext = createContext(null)
const AUTH_TIMEOUT_MS = 15000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Auth check timed out")), ms)
    }),
  ])
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [menus, setMenus] = useState([])
  const [capabilities, setCapabilities] = useState({})
  const [loading, setLoading] = useState(true)

  const loadRbac = useCallback(async () => {
    try {
      const { data } = await api.get("/rbac/me")
      setMenus(data.menus || [])
      setCapabilities(data.capabilities || {})
      return data
    } catch {
      setMenus([])
      setCapabilities({})
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (API_CONFIG_ERROR) {
        if (!cancelled) {
          setUser(null)
          setMenus([])
          setCapabilities({})
          setLoading(false)
        }
        return
      }
      try {
        const { data } = await withTimeout(api.get("/auth/me"), AUTH_TIMEOUT_MS)
        if (cancelled) return
        setUser(data)
        await loadRbac()
      } catch {
        if (cancelled) return
        setUser(null)
        setMenus([])
        setCapabilities({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadRbac])

  const login = async (email, password, otp) => {
    if (API_CONFIG_ERROR) {
      return { error: "API URL is not configured (REACT_APP_BACKEND_URL)" }
    }
    try {
      const { data } = await api.post("/auth/login", { email, password, otp: otp || null })
      if (data.requires_2fa) return { requires2fa: true }
      setToken(data.access_token)
      setUser(data.user)
      await loadRbac()
      return { ok: true }
    } catch (e) {
      return { error: apiError(e) }
    }
  }

  const logout = async () => {
    try {
      await api.post("/auth/logout")
    } catch {}
    setToken(null)
    setUser(null)
    setMenus([])
    setCapabilities({})
  }

  const can = (...roles) => user && roles.includes(user.role)
  const canCap = (cap) => Boolean(capabilities?.[cap])
  const hasMenu = (key) => (menus || []).some((m) => m.key === key)

  return (
    <AuthContext.Provider value={{
      user, setUser, loading, login, logout, can, canCap, hasMenu,
      menus, capabilities, refreshRbac: loadRbac,
      apiConfigError: API_CONFIG_ERROR,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
