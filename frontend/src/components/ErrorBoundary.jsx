import React from "react"
import { Link } from "react-router-dom"

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error("UI ErrorBoundary", error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6" data-testid="error-boundary">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
            <h1 className="font-heading text-xl font-bold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600">
              The page crashed unexpectedly. Try reloading, or sign in again.
            </p>
            <pre className="text-xs text-red-700 bg-red-50 border border-red-100 rounded p-2 overflow-auto max-h-28">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-2 text-sm rounded-md bg-[#0F284E] text-white"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <Link
                to="/login"
                className="px-3 py-2 text-sm rounded-md border border-slate-200 text-slate-700"
                onClick={() => {
                  try {
                    localStorage.removeItem("tcf_token")
                  } catch {}
                }}
              >
                Go to login
              </Link>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
