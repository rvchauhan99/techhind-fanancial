import React, { createContext, useContext, useEffect, useState, useCallback } from "react"
import api, { setToken, apiError } from "../lib/api"

const AuthContext = createContext(null)

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
    (async () => {
      try {
        const { data } = await api.get("/auth/me")
        setUser(data)
        await loadRbac()
      } catch {
        setUser(null)
        setMenus([])
        setCapabilities({})
      } finally {
        setLoading(false)
      }
    })()
  }, [loadRbac])

  const login = async (email, password, otp) => {
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
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
