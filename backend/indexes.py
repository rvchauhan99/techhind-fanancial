"""Mongo index bootstrap for TechHind Finance."""
from __future__ import annotations

import logging

from core import db

logger = logging.getLogger("indexes")


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.invoices.create_index([("status", 1), ("doc_type", 1)])
    await db.invoices.create_index("customer_id")
    await db.invoices.create_index("invoice_date")
    # Partial unique: drafts store invoice_no=null; sparse unique still indexes nulls
    try:
        await db.invoices.drop_index("invoice_no_unique_sparse")
    except Exception:
        pass
    await db.invoices.create_index(
        "invoice_no",
        unique=True,
        partialFilterExpression={"invoice_no": {"$type": "string"}},
        name="invoice_no_unique_partial",
    )
    await db.payments.create_index("customer_id")
    await db.payments.create_index("payment_date")
    try:
        await db.payments.drop_index("receipt_no_unique_sparse")
    except Exception:
        pass
    await db.payments.create_index(
        "receipt_no",
        unique=True,
        partialFilterExpression={"receipt_no": {"$type": "string"}},
        name="receipt_no_unique_partial",
    )
    await db.audit_logs.create_index("ts")
    await db.number_series.create_index(
        [("kind", 1), ("fy", 1)], unique=True, name="number_series_kind_fy"
    )
    await db.periods.create_index("month", unique=True)
    await db.subscriptions.create_index([("customer_id", 1), ("status", 1)])
    await db.subscriptions.create_index("next_renewal_on")
    await db.purchase_bills.create_index([("vendor_id", 1), ("status", 1)])
    await db.purchase_bills.create_index("bill_date")
    await db.expense_vouchers.create_index("status")
    await db.expense_vouchers.create_index("voucher_date")
    await db.email_log.create_index("ts")
    await db.vendors.create_index("gstin")
    await db.revoked_refresh.create_index("jti", unique=True)
    await db.revoked_refresh.create_index("exp", expireAfterSeconds=0)
    await db.customers.create_index("crm_tenant_key")
    await db.tickets.create_index([("status", 1), ("updated_at", -1)])
    await db.tickets.create_index("customer_id")
    await db.tickets.create_index("crm_tenant_key")
    await db.tickets.create_index("solar_user_id")
    await db.tickets.create_index("assignee_id")
    await db.tickets.create_index("category")
    await db.tickets.create_index("sla_due_at")
    await db.tickets.create_index([("status", 1), ("assignee_id", 1)])
    await db.tickets.create_index(
        "number",
        unique=True,
        partialFilterExpression={"number": {"$type": "string"}},
        name="ticket_number_unique_partial",
    )
    await db.ticket_messages.create_index([("ticket_id", 1), ("created_at", 1)])
    await db.ticket_messages.create_index(
        [("ticket_id", 1), ("visibility", 1), ("created_at", 1)],
        name="ticket_msg_visibility",
    )
    await db.notifications.create_index([("user_id", 1), ("read", 1), ("ts", -1)])
    await db.notifications.create_index("ticket_id")
    await db.notifications.create_index([("entity_type", 1), ("entity_id", 1)])
    await db.notifications.create_index("activity_id")
    await db.notifications.create_index(
        [("type", 1), ("read", 1), ("repeat_until_read", 1), ("ts", 1)],
        name="mention_nudge",
    )
    await db.org_roles.create_index("key", unique=True)
    await db.menus.create_index("key", unique=True)
    await db.role_menus.create_index(
        [("role_key", 1), ("menu_key", 1)], unique=True, name="role_menu_unique"
    )
    await db.projects.create_index([("status", 1), ("updated_at", -1)])
    await db.projects.create_index("customer_id")
    await db.projects.create_index(
        "number",
        unique=True,
        partialFilterExpression={"number": {"$type": "string"}},
        name="project_number_unique_partial",
    )
    await db.tasks.create_index([("status", 1), ("updated_at", -1)])
    await db.tasks.create_index("assignee_id")
    await db.tasks.create_index("project_id")
    await db.tasks.create_index("due_date")
    await db.tasks.create_index("task_type")
    await db.tasks.create_index("observer_ids")
    await db.tasks.create_index([("status", 1), ("due_date", 1)])
    await db.tasks.create_index("reminder_at")
    await db.tasks.create_index(
        "number",
        unique=True,
        partialFilterExpression={"number": {"$type": "string"}},
        name="task_number_unique_partial",
    )
    await db.work_activity.create_index([("entity_type", 1), ("entity_id", 1), ("ts", -1)])
    await db.bank_accounts.create_index("account_no")
    await db.bank_accounts.create_index([("account_type", 1), ("primary", -1)])
    await db.bank_ledger.create_index([("bank_id", 1), ("txn_date", 1)])
    await db.bank_ledger.create_index("reference_no")
    try:
        await db.bank_ledger.drop_index("bank_ledger_source_unique")
    except Exception:
        pass
    await db.bank_ledger.create_index(
        [("source_type", 1), ("source_id", 1)],
        unique=True,
        partialFilterExpression={"source_id": {"$type": "string"}},
        name="bank_ledger_source_unique",
    )
    logger.info("Mongo indexes ensured")
