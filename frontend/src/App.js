import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";
import PwaChrome from "./components/PwaChrome";
import ErrorBoundary from "./components/ErrorBoundary";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Products from "./pages/Products";
import Subscriptions from "./pages/Subscriptions";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import InvoiceForm from "./pages/InvoiceForm";
import Payments from "./pages/Payments";
import Aging from "./pages/Aging";
import Vendors from "./pages/Vendors";
import Expenses from "./pages/Expenses";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";
import Imports from "./pages/Imports";
import AccountantPack from "./pages/AccountantPack";
import PeriodClose from "./pages/PeriodClose";
import Tickets from "./pages/Tickets";
import TicketDetail from "./pages/TicketDetail";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import WorkReport from "./pages/WorkReport";
import Roles from "./pages/Roles";
import Banks from "./pages/Banks";
import BankStatement from "./pages/BankStatement";
import Profile from "./pages/Profile";
import ChangePasswordForm from "./components/ChangePasswordForm";

function PasswordChangeGate() {
  const { changePassword, homePath } = useAuth();
  const navigate = useNavigate();

  const handle = async ({ currentPassword, newPassword }) => {
    const res = await changePassword(currentPassword, newPassword);
    if (res.error) return res;
    navigate(homePath());
    return { ok: true };
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="password-change-gate">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-5 md:p-8 shadow-sm">
        <ChangePasswordForm onSubmit={handle} />
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading, apiConfigError } = useAuth();
  if (loading)
    return (
      <div className="h-screen flex items-center justify-center text-slate-500 text-sm" data-testid="auth-loading">
        Loading workspace…
      </div>
    );
  if (apiConfigError) return <Navigate to="/login?error=config" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <PasswordChangeGate />;
  return children;
}

function HomeRedirect() {
  const { homePath } = useAuth();
  return <Navigate to={homePath()} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/customers" element={<RequireAuth><Customers /></RequireAuth>} />
            <Route path="/customers/:id" element={<RequireAuth><CustomerDetail /></RequireAuth>} />
            <Route path="/products" element={<RequireAuth><Products /></RequireAuth>} />
            <Route path="/subscriptions" element={<RequireAuth><Subscriptions /></RequireAuth>} />
            <Route path="/invoices" element={<RequireAuth><Invoices /></RequireAuth>} />
            <Route path="/invoices/new" element={<RequireAuth><InvoiceForm /></RequireAuth>} />
            <Route path="/invoices/:id" element={<RequireAuth><InvoiceDetail /></RequireAuth>} />
            <Route path="/invoices/:id/edit" element={<RequireAuth><InvoiceForm /></RequireAuth>} />
            <Route path="/payments" element={<RequireAuth><Payments /></RequireAuth>} />
            <Route path="/aging" element={<RequireAuth><Aging /></RequireAuth>} />
            <Route path="/vendors" element={<RequireAuth><Vendors /></RequireAuth>} />
            <Route path="/expenses" element={<RequireAuth><Expenses /></RequireAuth>} />
            <Route path="/banks" element={<RequireAuth><Banks /></RequireAuth>} />
            <Route path="/banks/:id" element={<RequireAuth><BankStatement /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
            <Route path="/imports" element={<RequireAuth><Imports /></RequireAuth>} />
            <Route path="/accountant-pack" element={<RequireAuth><AccountantPack /></RequireAuth>} />
            <Route path="/period-close" element={<RequireAuth><PeriodClose /></RequireAuth>} />
            <Route path="/tickets" element={<RequireAuth><Tickets /></RequireAuth>} />
            <Route path="/tickets/:id" element={<RequireAuth><TicketDetail /></RequireAuth>} />
            <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
            <Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
            <Route path="/tasks" element={<RequireAuth><Tasks /></RequireAuth>} />
            <Route path="/tasks/:id" element={<RequireAuth><TaskDetail /></RequireAuth>} />
            <Route path="/work-report" element={<RequireAuth><WorkReport /></RequireAuth>} />
            <Route path="/roles" element={<RequireAuth><Roles /></RequireAuth>} />
            <Route path="*" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
      <PwaChrome />
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}
