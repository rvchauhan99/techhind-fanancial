"""Org RBAC seed — roles, menus, role_menus (idempotent upsert by key)."""
from __future__ import annotations

from core import db, iso_now, new_id

# Capability defaults per role key
ROLE_DEFS = [
    {
        "key": "admin",
        "name": "Admin",
        "description": "Full platform + finance + RBAC",
        "caps": dict(
            can_finance_write=True,
            can_finance_admin=True,
            can_finance_audit=True,
            can_work_write=True,
            can_work_manage=True,
            can_rbac_admin=True,
            can_ticket_write=True,
        ),
    },
    {
        "key": "accountant",
        "name": "Accountant",
        "description": "Finance write + audit + view work",
        "caps": dict(
            can_finance_write=True,
            can_finance_admin=False,
            can_finance_audit=True,
            can_work_write=False,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=True,
        ),
    },
    {
        "key": "ops",
        "name": "Ops",
        "description": "Finance write (limited) + work write",
        "caps": dict(
            can_finance_write=True,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=True,
        ),
    },
    {
        "key": "viewer",
        "name": "Viewer",
        "description": "Read-only finance + work",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=False,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "project_manager",
        "name": "Project Manager",
        "description": "Work manage + customers view + tasks",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=True,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "developer",
        "name": "Developer",
        "description": "My Work + projects (assigned)",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "qa",
        "name": "QA / UAT",
        "description": "UAT tasks + projects view",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "business_analyst",
        "name": "Business Analyst",
        "description": "BA sign-off on tasks ready to live",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "trainer",
        "name": "Trainer",
        "description": "Training tasks + demos",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "sales",
        "name": "Sales / Pre-sales",
        "description": "Demo schedule + customers view",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "support_agent",
        "name": "Support Agent",
        "description": "Support tickets + light work view",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=False,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=True,
        ),
    },
    {
        "key": "hr",
        "name": "HR",
        "description": "Users view (no finance money)",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=False,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=False,
        ),
    },
    {
        "key": "freelancer",
        "name": "Freelancer",
        "description": "Assigned tasks and tickets only",
        "caps": dict(
            can_finance_write=False,
            can_finance_admin=False,
            can_finance_audit=False,
            can_work_write=True,
            can_work_manage=False,
            can_rbac_admin=False,
            can_ticket_write=True,
        ),
    },
]

MENUS = [
    # Core
    ("dashboard", "Dashboard", "/dashboard", "Core", "LayoutDashboard", 10),
    ("tickets", "Support Tickets", "/tickets", "Core", "LifeBuoy", 20),
    ("projects", "Projects", "/projects", "Core", "FolderKanban", 30),
    ("tasks", "My Work", "/tasks", "Core", "ListTodo", 40),
    ("work_report", "Work Report", "/work-report", "Core", "BarChart3", 50),
    # Revenue
    ("invoices", "Invoices & Notes", "/invoices", "Revenue & GST", "FileText", 110),
    ("payments", "Payments & Receipts", "/payments", "Revenue & GST", "ReceiptIndianRupee", 120),
    ("customers", "Customers 360", "/customers", "Revenue & GST", "Building2", 130),
    ("subscriptions", "Subscriptions", "/subscriptions", "Revenue & GST", "Repeat", 140),
    ("products", "Products & Plans", "/products", "Revenue & GST", "Package", 150),
    # Payables
    ("vendors", "Vendors & Bills", "/vendors", "Payables & Expenses", "Briefcase", 210),
    ("expenses", "Expense Vouchers", "/expenses", "Payables & Expenses", "Wallet", 220),
    ("banks", "Bank Ledger", "/banks", "Payables & Expenses", "Landmark", 225),
    ("aging", "AR / AP Aging", "/aging", "Payables & Expenses", "CalendarClock", 230),
    # Governance
    ("period_close", "Period Close", "/period-close", "Governance", "Lock", 310),
    ("accountant_pack", "Accountant Pack", "/accountant-pack", "Governance", "FolderArchive", 320),
    ("imports", "CSV Import", "/imports", "Governance", "Upload", 330),
    ("audit", "Audit Trail", "/audit", "Governance", "ShieldCheck", 340),
    ("settings", "Settings & Masters", "/settings", "Governance", "Settings", 350),
    ("roles", "Roles & Access", "/roles", "Governance", "Users", 360),
]

# Menu keys each role gets (admin = all)
ROLE_MENU_KEYS = {
    "admin": [m[0] for m in MENUS],
    "accountant": [
        "dashboard", "tickets", "projects", "tasks", "work_report",
        "invoices", "payments", "customers", "subscriptions", "products",
        "vendors", "expenses", "banks", "aging",
        "period_close", "accountant_pack", "imports", "audit", "settings",
    ],
    "ops": [
        "dashboard", "tickets", "projects", "tasks",
        "invoices", "payments", "customers", "subscriptions", "products",
        "vendors", "expenses", "banks", "aging", "imports",
    ],
    "viewer": [
        "dashboard", "tickets", "projects", "tasks", "work_report",
        "invoices", "payments", "customers", "subscriptions", "products",
        "vendors", "expenses", "banks", "aging",
    ],
    "project_manager": [
        "dashboard", "projects", "tasks", "work_report", "customers", "tickets",
    ],
    "developer": ["dashboard", "projects", "tasks"],
    "qa": ["dashboard", "projects", "tasks"],
    "business_analyst": ["dashboard", "projects", "tasks", "work_report"],
    "trainer": ["dashboard", "projects", "tasks", "customers"],
    "sales": ["dashboard", "projects", "tasks", "customers"],
    "support_agent": ["dashboard", "tickets", "tasks", "customers"],
    "hr": ["dashboard", "settings", "roles"],
    "freelancer": ["tasks", "tickets"],
}

WORK_CATEGORIES = [
    "development",
    "uat",
    "testing",
    "customer_demo",
    "documentation",
    "training",
    "support_ops",
    "other",
]

# Alias used by task module (task_type)
TASK_TYPES = WORK_CATEGORIES

TASK_STATUSES = (
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "testing_rejected",
    "ready_to_live",
    "blocked",
    "done",
    "cancelled",
)


async def seed_rbac():
    now = iso_now()
    for r in ROLE_DEFS:
        caps = r["caps"]
        await db.org_roles.update_one(
            {"key": r["key"]},
            {
                "$set": {
                    "key": r["key"],
                    "name": r["name"],
                    "description": r["description"],
                    "is_system": True,
                    "active": True,
                    "updated_at": now,
                    **caps,
                },
                "$setOnInsert": {"id": new_id(), "created_at": now},
            },
            upsert=True,
        )

    for key, label, path, section, icon, sort_order in MENUS:
        await db.menus.update_one(
            {"key": key},
            {
                "$set": {
                    "key": key,
                    "label": label,
                    "path": path,
                    "section": section,
                    "icon": icon,
                    "sort_order": sort_order,
                    "active": True,
                    "updated_at": now,
                },
                "$setOnInsert": {"id": new_id(), "created_at": now},
            },
            upsert=True,
        )

    for role_key, menu_keys in ROLE_MENU_KEYS.items():
        for mk in menu_keys:
            await db.role_menus.update_one(
                {"role_key": role_key, "menu_key": mk},
                {
                    "$set": {"role_key": role_key, "menu_key": mk, "updated_at": now},
                    "$setOnInsert": {"id": new_id(), "created_at": now},
                },
                upsert=True,
            )

    # Ensure masters work categories / task types
    await db.masters.update_one(
        {"id": "masters"},
        {
            "$set": {
                "work_task_categories": [{"name": c} for c in WORK_CATEGORIES],
                "work_task_types": [{"name": c} for c in TASK_TYPES],
                "work_task_statuses": [{"name": s} for s in TASK_STATUSES],
            }
        },
        upsert=True,
    )
