import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";
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

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="h-screen flex items-center justify-center text-slate-500 text-sm" data-testid="auth-loading">
        Loading workspace…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
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
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}
