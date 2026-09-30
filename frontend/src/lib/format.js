export function fmtINR(n, withSymbol = true) {
  const v = Number(n || 0);
  const neg = v < 0;
  const s = Math.abs(v).toFixed(2);
  const [whole, frac] = s.split(".");
  let w = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    let rest = whole.slice(0, -3);
    const parts = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    w = parts.join(",") + "," + last3;
  }
  return (neg ? "-" : "") + (withSymbol ? "₹" : "") + w + "." + frac;
}

export function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

export function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d;
  }
}

export const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600 border-slate-300",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  partially_paid: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  posted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending_approval: "bg-amber-50 text-amber-700 border-amber-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  trial: "bg-sky-50 text-sky-700 border-sky-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  grace: "bg-amber-50 text-amber-700 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  paused: "bg-slate-100 text-slate-600 border-slate-300",
  expired: "bg-slate-100 text-slate-500 border-slate-300",
  open: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-300",
  planned: "bg-slate-100 text-slate-600 border-slate-300",
  on_hold: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  todo: "bg-slate-100 text-slate-600 border-slate-300",
  backlog: "bg-slate-100 text-slate-500 border-slate-300",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  in_review: "bg-violet-50 text-violet-700 border-violet-200",
  testing_rejected: "bg-red-50 text-red-700 border-red-200",
  ready_to_live: "bg-teal-50 text-teal-700 border-teal-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const STATUS_LABELS = {
  draft: "Draft", approved: "Approved", partially_paid: "Partially Paid", paid: "Paid",
  cancelled: "Cancelled", posted: "Posted", pending_approval: "Pending Approval",
  rejected: "Rejected", trial: "Trial", active: "Active", grace: "Grace",
  overdue: "Overdue", paused: "Paused", expired: "Expired",
  open: "Open", pending: "Pending", resolved: "Resolved", closed: "Closed",
  planned: "Planned", on_hold: "On Hold", completed: "Completed",
  backlog: "Backlog", todo: "To Do", in_progress: "In Progress",
  in_review: "In Review", testing_rejected: "Testing Rejected",
  ready_to_live: "Ready to Live", blocked: "Blocked", done: "Done",
};

export const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "in_review", "testing_rejected",
  "ready_to_live", "blocked", "done", "cancelled",
]

export const TASK_KANBAN = [
  "backlog", "todo", "in_progress", "in_review", "testing_rejected",
  "ready_to_live", "blocked", "done",
]

export const taskStatusLabel = (value) => STATUS_LABELS[value] || value

export const DOC_TYPE_LABELS = { INV: "Tax Invoice", CN: "Credit Note", DN: "Debit Note" };

export const INDIAN_STATES = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"],
  ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"],
  ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"],
  ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["27", "Maharashtra"], ["29", "Karnataka"],
  ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman & Nicobar"], ["36", "Telangana"], ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
];
