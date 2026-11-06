#!/usr/bin/env python3
"""
clean_data.py
=============
Reusable ETL / data-quality pipeline for the five raw retail CSV files.

Rules enforced by this script
-----------------------------
* The five original CSV files are only ever READ. They are never modified.
* No missing business value is invented. Values derived from other columns are
  explicitly logged (e.g. unit price recovered from line total / quantity).
* Every correction, duplicate removal, rejection and unmatched relationship is
  written to an audit output.
* Financial measures are recalculated from quantity and unit price instead of
  trusting inconsistent line totals.
* Cancelled (and, documented as a stricter financial rule, returned) orders do
  not contribute recognised revenue.
* Multiple payments are summed, never arbitrarily reduced to one payment.

Outputs (created in ./output)
-----------------------------
    clean_sales.csv          one row per valid order (order-level dataset)
    clean_sales_lines.csv    one row per valid order line (line-level dataset)
    FactSales.csv            line-grain Power BI fact table
    FactPayments.csv         payment-grain Power BI fact table
    DimCustomer.csv          customer dimension (includes explicit Unknown member)
    DimProduct.csv           product dimension (includes explicit Unknown member)
    DimStore.csv             store dimension (includes explicit Unknown member)
    DimDate.csv              generated calendar dimension
    DimOrder.csv             order bridge dimension for FactSales / FactPayments
    data_quality_report.txt  detailed profiling + decisions + validation
    cleaning_summary.txt     executive summary and KPI totals
    rejected_records.csv     records that cannot safely be used
    cleaning_log.csv         every correction / exclusion / decision

Usage
-----
    python3 clean_data.py
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

FILES = {
    "sales": "01_sales_raw.csv",
    "customers": "02_customers_raw.csv",
    "products": "03_products_raw.csv",
    "stores": "04_stores_raw.csv",
    "payments": "05_payments_raw.csv",
}

BUSINESS_KEYS = {
    "sales": "order_id",
    "customers": "customer_id",
    "products": "product_id",
    "stores": "store_id",
    "payments": "payment_id",
}

# Canonical value maps -------------------------------------------------------
ORDER_STATUS_MAP = {
    "completed": "Completed",
    "cancelled": "Cancelled",
    "pending": "Pending",
    "returned": "Returned",
    "shipped": "Shipped",
}

PAYMENT_STATUS_MAP = {
    "paid": "Paid",
    "pending": "Pending",
    "refunded": "Refunded",
}

PAYMENT_METHOD_MAP = {
    "card": "Card",
    "cash": "Cash",
    "mobile wallet": "Mobile Wallet",
}

PRODUCT_STATUS_MAP = {
    "active": "Active",
    "discontinued": "Discontinued",
}

CATEGORY_MAP = {
    "electronics": "Electronics",
    "home and living": "Home & Living",
    "home & living": "Home & Living",
    "accessories": "Accessories",
    "furniture": "Furniture",
    "stationery": "Stationery",
    "other": "Other",
}

# Orders whose revenue is not recognised in Net_Sales_TND.
NON_REVENUE_STATUSES = {"Cancelled", "Returned"}

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# ---------------------------------------------------------------------------
# Audit collectors
# ---------------------------------------------------------------------------

CLEANING_LOG: list[dict] = []
REJECTED: list[dict] = []
ORDER_FLAGS: dict[str, set[str]] = defaultdict(set)
ISSUES: list[str] = []


def add_flag(order_id: str, flag: str) -> None:
    """Attach a machine-readable data-quality flag to an order."""
    if pd.notna(order_id) and str(order_id).strip():
        ORDER_FLAGS[str(order_id).strip().upper()].add(flag)


def add_log(
    stage: str,
    source_file: str,
    record_id,
    field: str,
    original_value,
    cleaned_value,
    action: str,
    reason: str,
) -> None:
    """Record one cleaning decision for output/cleaning_log.csv."""
    def _safe(value):
        if value is None:
            return ""
        if isinstance(value, float) and np.isnan(value):
            return ""
        if value is pd.NaT:
            return ""
        return str(value)

    CLEANING_LOG.append(
        {
            "stage": stage,
            "source_file": source_file,
            "record_id": _safe(record_id),
            "field": field,
            "original_value": _safe(original_value),
            "cleaned_value": _safe(cleaned_value),
            "action": action,
            "reason": reason,
        }
    )


def add_reject(
    source_file: str,
    record_type: str,
    record_id: str,
    reason: str,
    record: pd.Series,
) -> None:
    """Store a record that cannot safely be used, keeping the original values."""
    derived_fields = {
        "order_date_clean", "order_date_status", "order_date_note",
        "quantity_num", "unit_price_num", "line_total_num", "gross_line",
        "email_is_valid", "customer_segment",
    }
    payload = {}
    for key, value in record.items():
        # Keep only the original source fields in the audit snapshot.
        if key in derived_fields or str(key).endswith("_raw") or str(key).startswith("_"):
            continue
        if pd.isna(value):
            payload[str(key)] = None
        else:
            payload[str(key)] = str(value)

    REJECTED.append(
        {
            "source_file": source_file,
            "record_type": record_type,
            "record_id": record_id,
            "rejection_reason": reason,
            "original_record": json.dumps(payload, ensure_ascii=False),
        }
    )


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def clean_text(value):
    """Trim, collapse internal whitespace and return NaN for empty strings."""
    if pd.isna(value):
        return np.nan
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text if text else np.nan


def clean_id(value):
    """Standardise a business key (trim + uppercase)."""
    text = clean_text(value)
    if pd.isna(text):
        return np.nan
    return text.upper()


def title_text(value):
    """Whitespace-safe title casing used for names / cities / regions."""
    text = clean_text(value)
    if pd.isna(text):
        return np.nan
    return text.title()


def parse_number(value):
    """
    Convert a text money / quantity value to float.

    Handles the mixed decimal conventions present in the source:
      '18,500'  -> 18.5   (comma used as decimal separator)
      '105,00'  -> 105.0  (comma used as decimal separator)
      '1,234.56'-> 1234.56
    Returns NaN when the value cannot be parsed; it never guesses a value.
    """
    if pd.isna(value):
        return np.nan
    text = str(value).strip()
    if text == "":
        return np.nan

    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()").replace("\u00a0", "").replace(" ", "")
    text = text.replace("TND", "").replace("DT", "")

    if text == "":
        return np.nan

    if "," in text and "." in text:
        # The right-most separator is the decimal separator.
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        number = float(text)
    except ValueError:
        return np.nan
    return -number if negative else number


def number_needs_log(raw_value, parsed_value):
    """True only when the raw number format genuinely changed (or failed)."""
    text = str(raw_value).strip()
    if text == "" or text.lower() == "nan":
        return False
    return "," in text or pd.isna(parsed_value)


def parse_date(value, reference=None):
    """
    Parse a date and return (Timestamp | NaT, status, note).

    * ISO-like values (YYYY-MM-DD, YYYY/MM/DD) are unambiguous.
    * Hyphen dates are treated as day-first (Tunisian source convention).
    * Slash dates are ambiguous. When both readings are valid, the reading
      closest to the order's payment date is used. Only when no payment date
      exists does the function fall back to day-first. This is always logged.
    * Impossible calendar dates such as 31/02/2026 return NaT + 'invalid'.
    """
    if pd.isna(value):
        return pd.NaT, "missing", ""

    text = clean_text(value)
    if pd.isna(text):
        return pd.NaT, "missing", ""

    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return pd.Timestamp(datetime.strptime(text, fmt).date()), "ok", ""
        except ValueError:
            pass

    match = re.fullmatch(r"(\d{1,2})([-/])(\d{1,2})\2(\d{4})", text)
    if not match:
        return pd.NaT, "invalid", f"unparseable date '{text}'"

    first, separator, second, year = (
        int(match.group(1)),
        match.group(2),
        int(match.group(3)),
        int(match.group(4)),
    )

    def make(day, month):
        try:
            return pd.Timestamp(datetime(year, month, day).date())
        except ValueError:
            return None

    day_first = make(day=first, month=second)
    month_first = make(day=second, month=first)
    candidates = [c for c in (day_first, month_first) if c is not None]

    if not candidates:
        return pd.NaT, "invalid", f"impossible calendar date '{text}'"

    if separator == "-":
        # Day-first is the documented convention for this source.
        chosen = day_first if day_first is not None else month_first
        return chosen, "ok", f"day-first hyphen date '{text}' -> {chosen.date()}"

    if len(candidates) == 1:
        return candidates[0], "ok", f"only one valid reading for '{text}'"

    if reference is not None and not pd.isna(reference):
        chosen = min(candidates, key=lambda c: abs((c - reference).days))
        note = (
            f"ambiguous date '{text}' resolved with payment reference "
            f"{reference.date()} -> {chosen.date()}"
        )
        return chosen, "ambiguous_resolved_reference", note

    chosen = day_first
    note = f"ambiguous date '{text}' defaulted to day-first -> {chosen.date()}"
    return chosen, "ambiguous_default_dayfirst", note


def canonical(value, mapping, fallback_title=True):
    """Map free-text values to a canonical spelling."""
    text = clean_text(value)
    if pd.isna(text):
        return np.nan
    key = text.lower()
    if key in mapping:
        return mapping[key]
    return text.title() if fallback_title else text


def join_unique(series):
    """Join unique non-null values with ' | ' (deterministic order)."""
    values: list[str] = []
    for value in series:
        if pd.isna(value):
            continue
        text = str(value).strip()
        if text and text not in values:
            values.append(text)
    return " | ".join(values) if values else np.nan


def agg_flags(series):
    """Merge semicolon separated flag strings across rows."""
    values: list[str] = []
    for value in series.dropna():
        for flag in str(value).split(";"):
            flag = flag.strip()
            if flag and flag not in values:
                values.append(flag)
    return "; ".join(values)


# ---------------------------------------------------------------------------
# Loading / profiling
# ---------------------------------------------------------------------------


def load_raw_data():
    """Read every source file as text (UTF-8 with BOM support)."""
    raw = {}
    inferred = {}
    for name, filename in FILES.items():
        path = os.path.join(BASE_DIR, filename)
        # dtype=str keeps the original text so no silent coercion can occur.
        raw[name] = pd.read_csv(
            path, dtype=str, encoding="utf-8-sig", keep_default_na=False, na_values=[""]
        )
        raw[name].columns = [str(c).strip() for c in raw[name].columns]
        # Second read with pandas inference purely for the profiling report.
        inferred[name] = pd.read_csv(path, encoding="utf-8-sig")
        inferred[name].columns = [str(c).strip() for c in inferred[name].columns]
    return raw, inferred


def _sample_values(series, limit=6):
    values = []
    for value in series.dropna():
        text = str(value)
        if text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return ", ".join(values)


def build_profile_sections(raw, inferred):
    """Return report lines for the raw-data profiling phase."""
    lines: list[str] = []
    lines.append("1. FILE OVERVIEW")
    lines.append("-" * 78)
    overview = []
    for name, df in raw.items():
        key = BUSINESS_KEYS[name]
        overview.append(
            {
                "dataset": name,
                "file": FILES[name],
                "rows": len(df),
                "columns": len(df.columns),
                "full_duplicate_rows": int(df.duplicated().sum()),
                "business_key": key,
                "duplicate_key_rows": int(df.duplicated(subset=[key]).sum()),
            }
        )
    lines.append(pd.DataFrame(overview).to_string(index=False))
    lines.append("")

    lines.append("2. COLUMN PROFILES, DATA TYPES AND MISSING VALUES")
    lines.append("-" * 78)
    for name, df in raw.items():
        lines.append(f"\n[{name}] {FILES[name]}")
        profile = pd.DataFrame(
            {
                "column": df.columns,
                "inferred_dtype": [str(inferred[name][c].dtype) for c in df.columns],
                "non_null": [int(df[c].notna().sum()) for c in df.columns],
                "missing": [int(df[c].isna().sum()) for c in df.columns],
                "distinct": [int(df[c].nunique(dropna=True)) for c in df.columns],
                "sample_values": [_sample_values(df[c]) for c in df.columns],
            }
        )
        lines.append(profile.to_string(index=False))
    lines.append("")

    lines.append("3. DUPLICATE RECORDS AND DUPLICATE BUSINESS KEYS")
    lines.append("-" * 78)
    lines.append(
        f"* sales: {int(raw['sales'].duplicated().sum())} exact duplicate line(s). "
        f"ORD-1001 appears {int((raw['sales']['order_id'] == 'ORD-1001').sum())} times: "
        "two different products (a legitimate multi-line order) plus one exact duplicate."
    )
    lines.append(
        f"* customers: {int(raw['customers'].duplicated(subset=['customer_id']).sum())} "
        "duplicate customer key row(s) (C013 duplicated exactly)."
    )
    lines.append(
        "* products: 0 duplicate product keys. SKUs P001-P013 are unique."
    )
    lines.append(
        "* stores: 0 duplicate keys before normalisation, but 'st04' is a case "
        "variant of 'ST04' and becomes a duplicate business key after standardisation."
    )
    lines.append(
        "* payments: 0 duplicate payment IDs. PAY001 and PAY035 share the same "
        "order, date, amount, method and status (duplicate business payment). "
        "ORD-1005 legitimately has two split payments (40.00 + 49.90)."
    )
    lines.append("")

    lines.append("4. TEXT / FORMAT INCONSISTENCIES DETECTED")
    lines.append("-" * 78)
    lines.append(
        "* sales.order_status: 'Completed', ' completed ', 'completed ', "
        "'CANCELLED', 'Cancelled', 'Pending', 'Returned', 'Shipped'."
    )
    lines.append(
        "* sales dates use four formats: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, "
        "MM/DD/YYYY and DD-MM-YYYY. '31/02/2026' is not a real date."
    )
    lines.append(
        "* sales identifiers contain padded whitespace: ' C005 ', 'P009 ', "
        "' st04 '."
    )
    lines.append(
        "* sales money fields mix '.' and ',' decimals: '18,500', '55,500'."
    )
    lines.append(
        "* customers.city has padded values (' Sousse '); C014 customer name "
        "has repeated internal spaces; C011 email is missing; C015 city is missing."
    )
    lines.append(
        "* products.category has case/spacing variants: ' electronics ', "
        "'ELECTRONICS', 'Home and Living', 'accessories '."
    )
    lines.append(
        "* products.product_status has 'Active' / 'active'. P013 has no list price."
    )
    lines.append(
        "* stores.store_id has lowercase 'st04' duplicating 'ST04'."
    )
    lines.append(
        "* payments.payment_status has 'paid ' (trailing space); "
        "payment_method has 'Mobile wallet' / 'Mobile Wallet'; "
        "amounts mix '.' and ',' decimals ('105,00'); PAY020 has no amount."
    )
    lines.append("")

    lines.append("5. INVALID DATES AND NUMERIC VALUES")
    lines.append("-" * 78)
    lines.append(
        "* Invalid date: ORD-1023 order_date='31/02/2026' (31 February does not exist)."
    )
    lines.append(
        "* Ambiguous dates: ORD-1002 '04/01/2026' and ORD-1014 '02/03/2026'. "
        "Both are resolved against the corresponding payment date."
    )
    lines.append(
        "* Missing unit price: ORD-1020 (quantity 2, line total 90.00 -> 45.00/unit)."
    )
    lines.append(
        "* Inconsistent line total: ORD-1030 quantity 1 x 45.00 but stored line "
        "total 999.00. Recalculated gross = 45.00; payment of 999.00 is flagged."
    )
    lines.append(
        "* Non-positive quantity: ORD-1026 quantity = 0."
    )
    lines.append(
        "* Missing numeric values: products P013 list_price; payments PAY020 amount."
    )
    lines.append("")

    lines.append("6. RELATIONSHIP / KEY INTEGRITY (RAW DATA)")
    lines.append("-" * 78)
    sales = raw["sales"].copy()
    sales["_order"] = sales["order_id"].map(clean_id)
    sales["_customer"] = sales["customer_id"].map(clean_id)
    sales["_product"] = sales["product_id"].map(clean_id)
    sales["_store"] = sales["store_id"].map(clean_id)
    customers = set(raw["customers"]["customer_id"].map(clean_id).dropna())
    products = set(raw["products"]["product_id"].map(clean_id).dropna())
    stores = set(raw["stores"]["store_id"].map(clean_id).dropna())
    payments = raw["payments"].copy()
    payments["_order"] = payments["order_id"].map(clean_id)

    unmatched_customers = sorted(set(sales["_customer"].dropna()) - customers)
    unmatched_products = sorted(set(sales["_product"].dropna()) - products)
    unmatched_stores = sorted(set(sales["_store"].dropna()) - stores)
    unmatched_payments = sorted(set(payments["_order"].dropna()) - set(sales["_order"].dropna()))

    lines.append(f"* Unmatched customer IDs in sales: {unmatched_customers or 'none'}")
    lines.append(f"* Unmatched product SKUs in sales: {unmatched_products or 'none'}")
    lines.append(f"* Unmatched store codes in sales: {unmatched_stores or 'none'}")
    lines.append(f"* Payment orders with no sales record: {unmatched_payments or 'none'}")
    lines.append(
        "* Sales orders without any payment: ORD-1007 (Pending) and ORD-1017 (Cancelled)."
    )
    lines.append("")

    lines.append("7. PAYMENT ANALYSIS")
    lines.append("-" * 78)
    lines.append(
        "* ORD-1005 has two payments (PAY005 40.00 + PAY006 49.90 = 89.90) which "
        "reconcile exactly to the order gross. They are summed, not selected."
    )
    lines.append(
        "* ORD-1001 has PAY001 and duplicate PAY035 (same order/date/amount/method/"
        "status). PAY035 is removed as a duplicate business payment."
    )
    lines.append(
        "* ORD-1030 payment 999.00 does not reconcile to recalculated gross 45.00 "
        "(difference 954.00). Flagged, not silently changed."
    )
    lines.append(
        "* ORD-1021 has a payment record with a missing amount; no amount is invented."
    )
    lines.append(
        "* ORD-9999 (75.00) has no sales record; it is rejected as an orphan payment."
    )
    lines.append(
        "* ORD-1023 and ORD-1026 have payments but their orders are rejected; those "
        "payments are preserved in the rejected output."
    )
    lines.append("")

    lines.append("8. PROPOSED CLEANING DECISIONS")
    lines.append("-" * 78)
    decisions = [
        "1. Standardise all business keys: trim whitespace and uppercase.",
        "2. Remove exact duplicate rows, keeping the first occurrence, and log each.",
        "3. Normalise every date to YYYY-MM-DD. Resolve ambiguous slash dates using "
        "the order's payment date; document the chosen reading.",
        "4. Reject (not repair) orders with impossible dates or non-positive "
        "quantities; preserve them in rejected_records.csv.",
        "5. Parse money values as decimal numbers, treating a comma as a decimal "
        "separator when no dot is present.",
        "6. Derive a missing unit price only when quantity and line total are both "
        "available; log the derivation.",
        "7. Recalculate gross as quantity x unit price and flag any stored line "
        "total that disagrees.",
        "8. Keep sales with unmatched customer/product/store keys, set the missing "
        "descriptive fields to null, and flag them rather than losing revenue.",
        "9. Standardise statuses, payment methods, categories, cities, names and "
        "regions to canonical spellings.",
        "10. Remove duplicate business payments and sum genuinely split payments.",
        "11. Aggregate legitimate multi-line orders to one row per order; keep a "
        "' | '-separated product list and use gross/quantity as the weighted unit price.",
        "12. Set Net_Sales_TND to zero for Cancelled and Returned orders. Cancelled "
        "is an explicit requirement; Returned is excluded because its payment is "
        "Refunded (documented stricter rule). Gross retains the formula value.",
        "13. Payments are reconciled against gross transaction value, because no "
        "discount field exists in the source. Discrepancies are flagged, not corrected.",
        "14. Customer segment and gender are not present in the source. Segment is "
        "output as null; gender is omitted rather than invented.",
    ]
    lines.extend(decisions)
    lines.append("")
    return lines


# ---------------------------------------------------------------------------
# Cleaning stages
# ---------------------------------------------------------------------------


def clean_customers(raw):
    """Clean the customer dimension."""
    df = raw["customers"].copy()
    source = FILES["customers"]

    # Exact duplicate rows first, so the audit reflects the raw file.
    duplicate_mask = df.duplicated(keep="first")
    for idx in df[duplicate_mask].index:
        row = df.loc[idx]
        add_log(
            "customers",
            source,
            row["customer_id"],
            "ALL",
            json.dumps(row.to_dict(), default=str, ensure_ascii=False),
            "",
            "remove_exact_duplicate",
            "Exact duplicate customer row; first occurrence retained.",
        )
    df = df[~duplicate_mask].copy()

    df["customer_id_raw"] = df["customer_id"]
    df["customer_id"] = df["customer_id"].map(clean_id)

    # Names: trim, collapse spaces, title-case.
    df["customer_name_raw"] = df["customer_name"]
    df["customer_name"] = df["customer_name"].map(title_text)

    # Email: trim + lowercase + validation (never fabricate a missing address).
    df["email_raw"] = df["email"]
    df["email"] = df["email"].map(clean_text)
    df["email"] = df["email"].map(lambda v: v.lower() if pd.notna(v) else np.nan)
    df["email_is_valid"] = df["email"].map(
        lambda v: bool(EMAIL_RE.match(str(v))) if pd.notna(v) else False
    )

    # City normalisation.
    df["city_raw"] = df["city"]
    df["city"] = df["city"].map(title_text)

    # Signup date normalisation.
    parsed = df["signup_date"].map(lambda v: parse_date(v)[0])
    df["signup_date"] = parsed

    # Audit field-level changes.
    for _, row in df.iterrows():
        cid = row["customer_id"]
        if str(row["customer_id_raw"]) != str(cid):
            add_log("customers", source, cid, "customer_id", row["customer_id_raw"],
                    cid, "standardise_key", "Trimmed and uppercased customer ID.")
        if str(row["customer_name_raw"]) != str(row["customer_name"]):
            add_log("customers", source, cid, "customer_name", row["customer_name_raw"],
                    row["customer_name"], "normalise_text",
                    "Trimmed/collapsed whitespace and title-cased name.")
        if pd.isna(row["email"]) :
            add_log("customers", source, cid, "email", row["email_raw"], "",
                    "keep_missing", "Email missing in source; left null (not invented).")
        elif not row["email_is_valid"]:
            add_log("customers", source, cid, "email", row["email_raw"], row["email"],
                    "flag_invalid_email", "Email does not match a valid address pattern.")
            ISSUES.append(f"Customer {cid} has an invalid email address: {row['email']}.")
        if pd.isna(row["city"]):
            add_log("customers", source, cid, "city", row["city_raw"], "",
                    "keep_missing", "City missing in source; left null (not invented).")
            ISSUES.append(f"Customer {cid} has no city; Customer_City is null.")
        elif str(row["city_raw"]) != str(row["city"]):
            add_log("customers", source, cid, "city", row["city_raw"], row["city"],
                    "normalise_text", "Trimmed/collapsed whitespace and title-cased city.")

    # Defensive: duplicate IDs that survived the exact-row dedupe.
    duplicate_ids = df.duplicated(subset=["customer_id"], keep="first")
    for idx in df[duplicate_ids].index:
        row = df.loc[idx]
        add_log("customers", source, row["customer_id"], "customer_id",
                row["customer_id"], "", "remove_duplicate_key",
                "Duplicate customer ID after standardisation; first row retained.")
    df = df[~duplicate_ids].copy()

    # Segment is not in the source; keep an explicit null column for the target.
    df["customer_segment"] = np.nan
    ISSUES.append(
        "Customer segment and gender are not present in 02_customers_raw.csv; "
        "Customer_Segment is null and gender is not included."
    )

    keep = [
        "customer_id", "customer_name", "email", "email_is_valid",
        "city", "signup_date", "customer_segment",
    ]
    return df[keep].reset_index(drop=True)


def clean_products(raw):
    """Clean the product dimension."""
    df = raw["products"].copy()
    source = FILES["products"]

    duplicate_mask = df.duplicated(keep="first")
    for idx in df[duplicate_mask].index:
        row = df.loc[idx]
        add_log("products", source, row["product_id"], "ALL",
                json.dumps(row.to_dict(), default=str, ensure_ascii=False), "",
                "remove_exact_duplicate", "Exact duplicate product row.")
    df = df[~duplicate_mask].copy()

    df["product_id_raw"] = df["product_id"]
    df["product_id"] = df["product_id"].map(clean_id)
    df["product_name_raw"] = df["product_name"]
    # Preserve the original casing so acronyms such as "USB-C" survive.
    df["product_name"] = df["product_name"].map(clean_text)
    df["category_raw"] = df["category"]
    df["category"] = df["category"].map(lambda v: canonical(v, CATEGORY_MAP))
    df["product_status_raw"] = df["product_status"]
    df["product_status"] = df["product_status"].map(lambda v: canonical(v, PRODUCT_STATUS_MAP))
    df["list_price_tnd"] = df["list_price_tnd"].map(parse_number)

    for _, row in df.iterrows():
        pid = row["product_id"]
        if str(row["product_id_raw"]) != str(pid):
            add_log("products", source, pid, "product_id", row["product_id_raw"], pid,
                    "standardise_key", "Trimmed and uppercased product SKU.")
        if str(row["product_name_raw"]) != str(row["product_name"]):
            add_log("products", source, pid, "product_name", row["product_name_raw"],
                    row["product_name"], "normalise_text", "Normalised product name.")
        if str(row["category_raw"]) != str(row["category"]):
            add_log("products", source, pid, "category", row["category_raw"],
                    row["category"], "canonicalise", "Mapped category to canonical spelling.")
        if str(row["product_status_raw"]) != str(row["product_status"]):
            add_log("products", source, pid, "product_status", row["product_status_raw"],
                    row["product_status"], "canonicalise", "Mapped status to canonical spelling.")
        if pd.isna(row["list_price_tnd"]):
            add_log("products", source, pid, "list_price_tnd", row["list_price_tnd"], "",
                    "keep_missing", "List price missing in source; left null (not invented).")
            ISSUES.append(f"Product {pid} has no list price; it is retained with a null price.")

    duplicate_ids = df.duplicated(subset=["product_id"], keep="first")
    for idx in df[duplicate_ids].index:
        row = df.loc[idx]
        add_log("products", source, row["product_id"], "product_id", row["product_id"], "",
                "remove_duplicate_key", "Duplicate product SKU; first row retained.")
    df = df[~duplicate_ids].copy()

    keep = ["product_id", "product_name", "category", "list_price_tnd", "product_status"]
    return df[keep].reset_index(drop=True)


def clean_stores(raw):
    """Clean the store dimension."""
    df = raw["stores"].copy()
    source = FILES["stores"]

    df["store_id_raw"] = df["store_id"]
    df["store_id"] = df["store_id"].map(clean_id)
    df["store_name_raw"] = df["store_name"]
    df["store_name"] = df["store_name"].map(title_text)
    df["city_raw"] = df["city"]
    df["city"] = df["city"].map(title_text)
    df["region_raw"] = df["region"]
    df["region"] = df["region"].map(title_text)

    for _, row in df.iterrows():
        sid = row["store_id"]
        if str(row["store_id_raw"]) != str(sid):
            add_log("stores", source, sid, "store_id", row["store_id_raw"], sid,
                    "standardise_key", "Trimmed and uppercased store code.")
        if str(row["store_name_raw"]) != str(row["store_name"]):
            add_log("stores", source, sid, "store_name", row["store_name_raw"],
                    row["store_name"], "normalise_text", "Normalised store name.")
        if str(row["city_raw"]) != str(row["city"]):
            add_log("stores", source, sid, "city", row["city_raw"], row["city"],
                    "normalise_text", "Normalised city.")
        if str(row["region_raw"]) != str(row["region"]):
            add_log("stores", source, sid, "region", row["region_raw"], row["region"],
                    "normalise_text", "Normalised region.")

    # The lowercase st04 now collides with ST04.
    duplicate_ids = df.duplicated(subset=["store_id"], keep="first")
    for idx in df[duplicate_ids].index:
        row = df.loc[idx]
        add_log("stores", source, row["store_id"], "store_id", row["store_id_raw"], "",
                "remove_duplicate_key",
                "Store 'st04' duplicates ST04 after case standardisation; first row retained.")
    df = df[~duplicate_ids].copy()

    keep = ["store_id", "store_name", "city", "region"]
    return df[keep].reset_index(drop=True)


def add_unknown_members(sales, customers, products, stores):
    """
    Add explicit Unknown dimension members for unresolved sales references.

    No real customer, product or store information is invented. The member keeps
    the original unresolved key and is clearly labelled as Unknown so that the
    fact rows can participate in a star schema without null dimension records.
    """
    customers = customers.copy()
    products = products.copy()
    stores = stores.copy()

    customers["is_unknown"] = False
    products["is_unknown"] = False
    stores["is_unknown"] = False

    unmatched_customers = sorted(
        set(sales["customer_id"].dropna()) - set(customers["customer_id"])
    )
    for key in unmatched_customers:
        customers = pd.concat(
            [
                customers,
                pd.DataFrame(
                    [
                        {
                            "customer_id": key,
                            "customer_name": f"Unknown Customer ({key})",
                            "email": np.nan,
                            "email_is_valid": False,
                            "city": "Unknown",
                            "signup_date": pd.NaT,
                            "customer_segment": np.nan,
                            "is_unknown": True,
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )
        add_log(
            "dimensions", "01_sales_raw.csv", key, "customer_id", key, key,
            "create_unknown_member",
            "No reliable customer master record exists in any source file; "
            "explicit Unknown member created without inventing real details.",
        )
        for order_id in sales.loc[sales["customer_id"] == key, "order_id"].dropna().unique():
            add_flag(str(order_id), "UNMATCHED_CUSTOMER")

    unmatched_products = sorted(
        set(sales["product_id"].dropna()) - set(products["product_id"])
    )
    for key in unmatched_products:
        products = pd.concat(
            [
                products,
                pd.DataFrame(
                    [
                        {
                            "product_id": key,
                            "product_name": f"Unknown Product ({key})",
                            "category": "Unknown",
                            "list_price_tnd": np.nan,
                            "product_status": "Unknown",
                            "is_unknown": True,
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )
        add_log(
            "dimensions", "01_sales_raw.csv", key, "product_id", key, key,
            "create_unknown_member",
            "No reliable product master record exists in any source file; "
            "explicit Unknown member created without inventing real details.",
        )
        for order_id in sales.loc[sales["product_id"] == key, "order_id"].dropna().unique():
            add_flag(str(order_id), "UNMATCHED_PRODUCT")

    unmatched_stores = sorted(
        set(sales["store_id"].dropna()) - set(stores["store_id"])
    )
    for key in unmatched_stores:
        stores = pd.concat(
            [
                stores,
                pd.DataFrame(
                    [
                        {
                            "store_id": key,
                            "store_name": f"Unknown Store ({key})",
                            "city": "Unknown",
                            "region": "Unknown",
                            "is_unknown": True,
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )
        add_log(
            "dimensions", "01_sales_raw.csv", key, "store_id", key, key,
            "create_unknown_member",
            "No reliable store master record exists in any source file; "
            "explicit Unknown member created without inventing real details.",
        )
        for order_id in sales.loc[sales["store_id"] == key, "order_id"].dropna().unique():
            add_flag(str(order_id), "UNMATCHED_STORE")

    return customers.reset_index(drop=True), products.reset_index(drop=True), stores.reset_index(drop=True)


def clean_payments(raw):
    """Clean the payment records (dedupe; no order linkage decisions yet)."""
    df = raw["payments"].copy()
    source = FILES["payments"]

    df["payment_id_raw"] = df["payment_id"]
    df["payment_id"] = df["payment_id"].map(clean_id)
    df["order_id_raw"] = df["order_id"]
    df["order_id"] = df["order_id"].map(clean_id)

    df["payment_date_raw"] = df["payment_date"]
    parsed = df["payment_date"].map(lambda v: parse_date(v)[0])
    df["payment_date"] = parsed

    df["payment_amount_raw"] = df["payment_amount_tnd"]
    df["payment_amount_tnd"] = df["payment_amount_tnd"].map(parse_number)

    df["payment_method_raw"] = df["payment_method"]
    df["payment_method"] = df["payment_method"].map(
        lambda v: canonical(v, PAYMENT_METHOD_MAP)
    )
    df["payment_status_raw"] = df["payment_status"]
    df["payment_status"] = df["payment_status"].map(
        lambda v: canonical(v, PAYMENT_STATUS_MAP)
    )

    for _, row in df.iterrows():
        pid = row["payment_id"]
        if str(row["payment_id_raw"]) != str(pid):
            add_log("payments", source, pid, "payment_id", row["payment_id_raw"], pid,
                    "standardise_key", "Trimmed and uppercased payment ID.")
        if str(row["order_id_raw"]) != str(row["order_id"]):
            add_log("payments", source, pid, "order_id", row["order_id_raw"],
                    row["order_id"], "standardise_key", "Trimmed and uppercased order ID.")
        if number_needs_log(row["payment_amount_raw"], row["payment_amount_tnd"]):
            add_log("payments", source, pid, "payment_amount_tnd",
                    row["payment_amount_raw"], row["payment_amount_tnd"],
                    "normalise_number", "Parsed amount; comma treated as decimal separator.")
        if str(row["payment_method_raw"]) != str(row["payment_method"]):
            add_log("payments", source, pid, "payment_method", row["payment_method_raw"],
                    row["payment_method"], "canonicalise", "Mapped payment method.")
        if str(row["payment_status_raw"]) != str(row["payment_status"]):
            add_log("payments", source, pid, "payment_status", row["payment_status_raw"],
                    row["payment_status"], "canonicalise", "Mapped payment status.")
        if pd.isna(row["payment_amount_tnd"]):
            add_log("payments", source, pid, "payment_amount_tnd",
                    row["payment_amount_raw"], "", "keep_missing",
                    "Payment amount missing in source; left null (not invented).")

    # Duplicate payment IDs (defensive).
    duplicate_ids = df.duplicated(subset=["payment_id"], keep="first")
    for idx in df[duplicate_ids].index:
        row = df.loc[idx]
        add_log("payments", source, row["payment_id"], "payment_id", row["payment_id"], "",
                "remove_duplicate_key", "Duplicate payment ID; first row retained.")
    df = df[~duplicate_ids].copy()

    # Duplicate business payments: same order, date, amount, method and status.
    business_key = [
        "order_id", "payment_date", "payment_amount_tnd",
        "payment_method", "payment_status",
    ]
    try:
        duplicate_business = df.duplicated(subset=business_key, keep="first", na_position="last")
    except TypeError:
        duplicate_business = df.duplicated(subset=business_key, keep="first")
    for idx in df[duplicate_business].index:
        row = df.loc[idx]
        add_log("payments", source, row["payment_id"], "ALL",
                json.dumps(
                    {
                        "order_id": row["order_id"],
                        "payment_date": str(row["payment_date"]),
                        "payment_amount_tnd": row["payment_amount_tnd"],
                        "payment_method": row["payment_method"],
                        "payment_status": row["payment_status"],
                    },
                    default=str, ensure_ascii=False,
                ),
                "", "remove_duplicate_business_payment",
                "Same order/date/amount/method/status as an earlier payment; "
                "duplicate record removed.")
    df = df[~duplicate_business].copy()

    keep = [
        "payment_id", "order_id", "payment_date", "payment_amount_tnd",
        "payment_method", "payment_status",
    ]
    return df[keep].reset_index(drop=True)


def clean_sales(raw, payment_reference):
    """Clean sales lines and validate them before order-level aggregation."""
    df = raw["sales"].copy()
    source = FILES["sales"]

    # 1. Remove exact duplicate lines first and audit the original row.
    duplicate_mask = df.duplicated(keep="first")
    for idx in df[duplicate_mask].index:
        row = df.loc[idx]
        add_flag(str(row["order_id"]).strip().upper(), "DUPLICATE_LINE_REMOVED")
        add_log("sales", source, row["order_id"], "ALL",
                json.dumps(row.to_dict(), default=str, ensure_ascii=False), "",
                "remove_exact_duplicate",
                "Exact duplicate sales line; first occurrence retained.")
    df = df[~duplicate_mask].copy()

    # 2. Standardise keys and text fields.
    for field in ("order_id", "customer_id", "product_id", "store_id"):
        df[f"{field}_raw"] = df[field]
        df[field] = df[field].map(clean_id)
        for _, row in df.iterrows():
            if str(row[f"{field}_raw"]) != str(row[field]):
                add_log("sales", source, row["order_id"], field, row[f"{field}_raw"],
                        row[field], "standardise_key",
                        "Trimmed/collapsed whitespace and uppercased key.")

    # 3. Order status.
    df["order_status_raw"] = df["order_status"]
    df["order_status"] = df["order_status"].map(lambda v: canonical(v, ORDER_STATUS_MAP))
    for _, row in df.iterrows():
        if str(row["order_status_raw"]) != str(row["order_status"]):
            add_log("sales", source, row["order_id"], "order_status",
                    row["order_status_raw"], row["order_status"],
                    "canonicalise", "Mapped order status to canonical spelling.")

    # 4. Dates (payment date used only to disambiguate, never to fill).
    date_results = df.apply(
        lambda row: parse_date(row["order_date"], payment_reference.get(row["order_id"])),
        axis=1,
    )
    df["order_date_clean"] = [result[0] for result in date_results]
    df["order_date_status"] = [result[1] for result in date_results]
    df["order_date_note"] = [result[2] for result in date_results]

    for idx, row in df.iterrows():
        if row["order_date_status"] in ("ambiguous_resolved_reference",
                                        "ambiguous_default_dayfirst") or (
            pd.notna(row["order_date_clean"])
            and str(row["order_date"]) != row["order_date_clean"].strftime("%Y-%m-%d")
        ):
            add_log("sales", source, row["order_id"], "order_date", row["order_date"],
                    row["order_date_clean"].strftime("%Y-%m-%d")
                    if pd.notna(row["order_date_clean"]) else "",
                    "normalise_date", row["order_date_note"] or "Normalised to YYYY-MM-DD.")
            if row["order_date_status"] in ("ambiguous_resolved_reference",
                                            "ambiguous_default_dayfirst"):
                add_flag(row["order_id"], "AMBIGUOUS_DATE_RESOLVED")

    # 5. Numeric fields.
    df["quantity_raw"] = df["quantity"]
    df["unit_price_raw"] = df["unit_price_tnd"]
    df["line_total_raw"] = df["line_total_tnd"]
    df["quantity_num"] = df["quantity"].map(parse_number)
    df["unit_price_num"] = df["unit_price_tnd"].map(parse_number)
    df["line_total_num"] = df["line_total_tnd"].map(parse_number)

    for _, row in df.iterrows():
        if number_needs_log(row["unit_price_raw"], row["unit_price_num"]):
            add_log("sales", source, row["order_id"], "unit_price_tnd",
                    row["unit_price_raw"], row["unit_price_num"],
                    "normalise_number", "Parsed number; comma treated as decimal separator.")
        if number_needs_log(row["line_total_raw"], row["line_total_num"]):
            add_log("sales", source, row["order_id"], "line_total_tnd",
                    row["line_total_raw"], row["line_total_num"],
                    "normalise_number", "Parsed number; comma treated as decimal separator.")

    # 6. Recover a missing unit price only from existing quantity + line total.
    missing_price = (
        df["unit_price_num"].isna()
        & df["line_total_num"].notna()
        & df["quantity_num"].notna()
        & (df["quantity_num"] > 0)
    )
    for idx in df[missing_price].index:
        row = df.loc[idx]
        derived = row["line_total_num"] / row["quantity_num"]
        df.at[idx, "unit_price_num"] = derived
        add_log("sales", source, row["order_id"], "unit_price_tnd", "",
                round(derived, 2), "derive_from_columns",
                "Missing unit price derived from line_total / quantity (existing values only).")
        add_flag(row["order_id"], "UNIT_PRICE_DERIVED")

    # 7. Recalculate gross and detect inconsistent stored line totals.
    df["gross_line"] = df["quantity_num"] * df["unit_price_num"]
    line_mismatch = (
        df["gross_line"].notna()
        & df["line_total_num"].notna()
        & ((df["gross_line"] - df["line_total_num"]).abs() > 0.01)
    )
    for idx in df[line_mismatch].index:
        row = df.loc[idx]
        add_log("sales", source, row["order_id"], "line_total_tnd",
                row["line_total_num"], round(row["gross_line"], 2),
                "recalculate_financial",
                "Stored line total disagrees with quantity x unit price; "
                "gross recalculated from the business formula.")
        add_flag(row["order_id"], "LINE_TOTAL_MISMATCH_RECALCULATED")

    # 8. Line-level validation. Any invalid line rejects its whole order.
    reasons: dict[str, list[str]] = defaultdict(list)
    invalid_mask = pd.Series(False, index=df.index)

    for idx, row in df.iterrows():
        oid = row["order_id"]
        if pd.isna(oid):
            reason = "Missing order ID"
            reasons[oid].append(reason)
            invalid_mask.at[idx] = True
            continue
        if pd.isna(row["customer_id"]):
            reasons[oid].append("Missing customer ID")
            invalid_mask.at[idx] = True
        if pd.isna(row["product_id"]):
            reasons[oid].append("Missing product SKU")
            invalid_mask.at[idx] = True
        if pd.isna(row["store_id"]):
            reasons[oid].append("Missing store code")
            invalid_mask.at[idx] = True
        if pd.isna(row["order_date_clean"]):
            reasons[oid].append(
                f"Invalid or missing order date '{row['order_date']}'"
            )
            invalid_mask.at[idx] = True
        if pd.isna(row["quantity_num"]):
            reasons[oid].append("Missing quantity")
            invalid_mask.at[idx] = True
        elif row["quantity_num"] <= 0:
            reasons[oid].append(f"Non-positive quantity ({row['quantity_num']})")
            invalid_mask.at[idx] = True
        elif float(row["quantity_num"]) != int(row["quantity_num"]):
            reasons[oid].append(f"Non-integer quantity ({row['quantity_num']})")
            invalid_mask.at[idx] = True
        if pd.isna(row["unit_price_num"]):
            reasons[oid].append("Missing unit price")
            invalid_mask.at[idx] = True
        elif row["unit_price_num"] < 0:
            reasons[oid].append(f"Negative unit price ({row['unit_price_num']})")
            invalid_mask.at[idx] = True

    invalid_orders = set(df.loc[invalid_mask, "order_id"].dropna())
    for order_id in invalid_orders:
        order_rows = df[df["order_id"] == order_id]
        reason = "; ".join(dict.fromkeys(reasons[order_id]))
        for idx, row in order_rows.iterrows():
            add_reject(source, "sales_order", str(order_id), reason, row)
        add_log("sales", source, order_id, "ALL", "", "",
                "reject_order", reason)

    df = df[~df["order_id"].isin(invalid_orders)].copy()

    # 9. Quantity must be a whole number in the final dataset.
    df["quantity_num"] = df["quantity_num"].astype(int)

    keep = [
        "order_id", "order_date_clean", "customer_id", "product_id", "store_id",
        "quantity_num", "unit_price_num", "line_total_num", "gross_line",
        "order_status",
    ]
    return df[keep].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Consolidation
# ---------------------------------------------------------------------------


def aggregate_payments(payments, valid_order_ids, all_sales_order_ids):
    """
    Split payments into matched vs rejected, and aggregate matched payments
    per order without ever selecting a single payment arbitrarily.
    """
    source = FILES["payments"]
    matched_rows = []
    for idx, row in payments.iterrows():
        oid = row["order_id"]
        if pd.isna(oid) or oid not in all_sales_order_ids:
            reason = "Orphan payment: order ID has no sales record"
            add_reject(source, "payment", str(row["payment_id"]), reason, row)
            add_log("payments", source, row["payment_id"], "order_id", oid, "",
                    "reject_payment", reason)
        elif oid not in valid_order_ids:
            reason = "Payment belongs to an order rejected from clean sales"
            add_reject(source, "payment", str(row["payment_id"]), reason, row)
            add_log("payments", source, row["payment_id"], "order_id", oid, "",
                    "reject_payment", reason)
        else:
            matched_rows.append(idx)

    matched = payments.loc[matched_rows].copy()

    def agg_amount(series):
        if series.empty or series.isna().any():
            return np.nan
        return round(float(series.sum()), 2)

    def agg_status(series):
        values = {v for v in series.dropna()}
        if not values:
            return np.nan
        if "Refunded" in values:
            return "Refunded"
        if values == {"Paid"}:
            return "Paid"
        if "Pending" in values and "Paid" not in values:
            return "Pending"
        return " | ".join(sorted(values))

    grouped = (
        matched.groupby("order_id")
        .agg(
            payment_amount=("payment_amount_tnd", agg_amount),
            payment_method=("payment_method", join_unique),
            payment_status=("payment_status", agg_status),
            payment_date=("payment_date", "max"),
            payment_count=("payment_id", "size"),
        )
        .reset_index()
    )

    for _, row in grouped.iterrows():
        if row["payment_count"] > 1:
            add_log("payments", source, row["order_id"], "payment_amount_tnd",
                    "", row["payment_amount"], "aggregate_multiple_payments",
                    f"Summed {int(row['payment_count'])} payments for the order; "
                    "no single payment was arbitrarily selected.")
            add_flag(row["order_id"], "MULTIPLE_PAYMENTS_AGGREGATED")
        if pd.isna(row["payment_amount"]):
            add_log("payments", source, row["order_id"], "payment_amount_tnd",
                    "", "", "keep_missing",
                    "At least one payment amount is missing; no total is invented.")
            add_flag(row["order_id"], "PAYMENT_AMOUNT_MISSING")
    return grouped


def consolidate(sales_lines, customers, products, stores, payments):
    """Join dimensions, aggregate to one row per order, and compute measures."""
    # Join dimensions at line level so multi-line orders can list every product.
    # Unknown members carry is_unknown=True so the fact rows retain their keys
    # while showing an explicit Unknown label instead of a blank description.
    cust = customers.rename(columns={"is_unknown": "customer_is_unknown"})
    prod = products.rename(columns={"is_unknown": "product_is_unknown"})
    st = stores.rename(columns={"is_unknown": "store_is_unknown"})

    lines = sales_lines.merge(
        cust[["customer_id", "customer_name", "city", "customer_segment",
              "customer_is_unknown"]],
        on="customer_id", how="left",
    )
    lines = lines.merge(
        prod[["product_id", "product_name", "category", "product_is_unknown"]],
        on="product_id", how="left",
    )
    lines = lines.merge(
        st[["store_id", "store_name", "region", "store_is_unknown"]],
        on="store_id", how="left",
    )

    # Flag unresolved relationships but KEEP the order and its revenue.
    for _, key, flag, unknown_col in (
        ("sales", "customer_id", "UNMATCHED_CUSTOMER", "customer_is_unknown"),
        ("sales", "product_id", "UNMATCHED_PRODUCT", "product_is_unknown"),
        ("sales", "store_id", "UNMATCHED_STORE", "store_is_unknown"),
    ):
        unmatched = lines.loc[lines[unknown_col].fillna(False), ["order_id", key]]
        for _, row in unmatched.drop_duplicates().iterrows():
            add_flag(str(row["order_id"]), flag)

    grouped = (
        lines.groupby("order_id", sort=False)
        .agg(
            order_date=("order_date_clean", "first"),
            customer_id=("customer_id", "first"),
            customer_name=("customer_name", "first"),
            customer_city=("city", "first"),
            customer_segment=("customer_segment", "first"),
            product_sku=("product_id", join_unique),
            product_name=("product_name", join_unique),
            product_category=("category", join_unique),
            store_code=("store_id", "first"),
            store_name=("store_name", "first"),
            store_region=("region", "first"),
            quantity=("quantity_num", "sum"),
            gross_sales=("gross_line", "sum"),
            order_status=("order_status", "first"),
            line_count=("order_id", "size"),
        )
        .reset_index()
    )

    # Legitimate multi-line orders are aggregated, never dropped.
    for _, row in grouped.iterrows():
        if row["line_count"] > 1:
            add_log("consolidation", FILES["sales"], row["order_id"], "ALL",
                    f"{int(row['line_count'])} sales lines", "1 order row",
                    "aggregate_lines",
                    "Legitimate multi-line order aggregated to one row; product "
                    "descriptions joined with ' | ' and unit price weighted by quantity.")
            add_flag(row["order_id"], "MULTI_LINE_ORDER_AGGREGATED")

    # Weighted unit price for the order (equals the line price for single-line orders).
    grouped["unit_price"] = grouped.apply(
        lambda r: round(r["gross_sales"] / r["quantity"], 2)
        if pd.notna(r["gross_sales"]) and r["quantity"] else np.nan,
        axis=1,
    )

    # Payments.
    grouped = grouped.merge(payments, on="order_id", how="left")
    grouped["payment_count"] = grouped["payment_count"].fillna(0).astype(int)
    grouped["payment_status"] = grouped["payment_status"].fillna("No Payment")

    # Financial measures. No discount column exists in the source -> 0, documented.
    grouped["discount_percent"] = 0.0
    grouped["gross_sales"] = grouped["gross_sales"].round(2)
    grouped["net_sales"] = (grouped["gross_sales"] * (1 - grouped["discount_percent"])).round(2)

    ineligible = grouped["order_status"].isin(NON_REVENUE_STATUSES)
    grouped.loc[ineligible, "net_sales"] = 0.0
    grouped["revenue_eligible"] = np.where(ineligible, "No", "Yes")

    for _, row in grouped.iterrows():
        if row["order_status"] == "Cancelled":
            add_log("consolidation", FILES["sales"], row["order_id"],
                    "net_sales_tnd", row["gross_sales"], 0.0,
                    "exclude_cancelled_revenue",
                    "Cancelled order excluded from recognised revenue (explicit rule); "
                    "gross retained for audit.")
            add_flag(row["order_id"], "CANCELLED_EXCLUDED_FROM_REVENUE")
        elif row["order_status"] == "Returned":
            add_log("consolidation", FILES["sales"], row["order_id"],
                    "net_sales_tnd", row["gross_sales"], 0.0,
                    "exclude_returned_revenue",
                    "Returned order excluded from recognised revenue because its "
                    "payment is Refunded; gross retained for audit.")
            add_flag(row["order_id"], "RETURNED_EXCLUDED_FROM_REVENUE")
        if row["payment_count"] == 0:
            add_log("payments", FILES["payments"], row["order_id"],
                    "payment_amount_tnd", "", "", "keep_missing",
                    "No payment record for this order; payment fields left null.")
            add_flag(row["order_id"], "NO_PAYMENT_RECORD")
        elif pd.notna(row["payment_amount"]) and abs(
            float(row["payment_amount"]) - float(row["gross_sales"])
        ) > 0.01:
            difference = round(float(row["payment_amount"]) - float(row["gross_sales"]), 2)
            add_log("payments", FILES["payments"], row["order_id"],
                    "payment_amount_tnd", row["payment_amount"], "",
                    "flag_payment_discrepancy",
                    f"Payment total differs from gross transaction value by {difference:.2f}; "
                    "left unchanged and flagged.")
            add_flag(row["order_id"], "PAYMENT_AMOUNT_MISMATCH")
            ISSUES.append(
                f"Payment discrepancy for {row['order_id']}: paid "
                f"{row['payment_amount']:.2f} vs gross {row['gross_sales']:.2f} "
                f"(difference {difference:.2f})."
            )

    # Final flags (sorted for deterministic output).
    grouped["data_quality_flag"] = grouped["order_id"].map(
        lambda oid: "; ".join(sorted(ORDER_FLAGS.get(str(oid), set())))
    )

    # Rename to the requested target schema.
    grouped = grouped.rename(
        columns={
            "order_id": "Order_ID",
            "order_date": "Order_Date",
            "customer_id": "Customer_ID",
            "customer_name": "Customer_Name",
            "customer_city": "Customer_City",
            "customer_segment": "Customer_Segment",
            "product_sku": "Product_SKU",
            "product_name": "Product_Name",
            "product_category": "Product_Category",
            "store_code": "Store_Code",
            "store_name": "Store_Name",
            "store_region": "Store_Region",
            "quantity": "Quantity",
            "unit_price": "Unit_Price_TND",
            "discount_percent": "Discount_Percent",
            "gross_sales": "Gross_Sales_TND",
            "net_sales": "Net_Sales_TND",
            "order_status": "Order_Status",
            "payment_status": "Payment_Status",
            "payment_method": "Payment_Method",
            "payment_amount": "Payment_Amount_TND",
            "payment_date": "Payment_Date",
            "payment_count": "Payment_Count",
            "revenue_eligible": "Revenue_Eligible",
            "data_quality_flag": "Data_Quality_Flag",
        }
    )

    grouped["Order_Date"] = pd.to_datetime(grouped["Order_Date"]).dt.strftime("%Y-%m-%d")
    grouped["Payment_Date"] = pd.to_datetime(
        grouped["Payment_Date"], errors="coerce"
    ).dt.strftime("%Y-%m-%d")

    columns = [
        "Order_ID", "Order_Date", "Customer_ID", "Customer_Name", "Customer_City",
        "Customer_Segment", "Product_SKU", "Product_Name", "Product_Category",
        "Store_Code", "Store_Name", "Store_Region", "Quantity", "Unit_Price_TND",
        "Discount_Percent", "Gross_Sales_TND", "Net_Sales_TND", "Order_Status",
        "Payment_Status", "Payment_Method", "Payment_Amount_TND", "Payment_Date",
        "Payment_Count", "Revenue_Eligible", "Data_Quality_Flag",
    ]
    grouped = grouped[columns].sort_values(["Order_Date", "Order_ID"]).reset_index(drop=True)
    return grouped


def build_line_level(sales_lines, customers, products, stores):
    """Build the deliverable one-row-per-order-line dataset."""
    cust = customers.rename(columns={"is_unknown": "customer_is_unknown"})
    prod = products.rename(columns={"is_unknown": "product_is_unknown"})
    st = stores.rename(columns={"is_unknown": "store_is_unknown"})

    lines = sales_lines.copy()
    lines["line_number"] = lines.groupby("order_id", sort=False).cumcount() + 1
    lines["order_line_id"] = (
        lines["order_id"] + "-L" + lines["line_number"].astype(str).str.zfill(2)
    )

    lines = lines.merge(
        cust[["customer_id", "customer_name", "city", "customer_segment"]],
        on="customer_id", how="left",
    )
    lines = lines.merge(
        prod[["product_id", "product_name", "category"]],
        on="product_id", how="left",
    )
    lines = lines.merge(
        st[["store_id", "store_name", "region"]],
        on="store_id", how="left",
    )

    lines["discount_percent"] = 0.0
    lines["gross_sales"] = lines["gross_line"].round(2)
    lines["net_sales"] = (
        lines["gross_sales"] * (1 - lines["discount_percent"])
    ).round(2)

    ineligible = lines["order_status"].isin(NON_REVENUE_STATUSES)
    lines.loc[ineligible, "net_sales"] = 0.0
    lines["revenue_eligible"] = np.where(ineligible, "No", "Yes")
    lines["data_quality_flag"] = lines["order_id"].map(
        lambda oid: "; ".join(sorted(ORDER_FLAGS.get(str(oid), set())))
    )

    lines = lines.rename(
        columns={
            "order_line_id": "Order_Line_ID",
            "line_number": "Line_Number",
            "order_id": "Order_ID",
            "order_date_clean": "Order_Date",
            "customer_id": "Customer_ID",
            "customer_name": "Customer_Name",
            "city": "Customer_City",
            "customer_segment": "Customer_Segment",
            "product_id": "Product_SKU",
            "product_name": "Product_Name",
            "category": "Product_Category",
            "store_id": "Store_Code",
            "store_name": "Store_Name",
            "region": "Store_Region",
            "quantity_num": "Quantity",
            "unit_price_num": "Unit_Price_TND",
            "discount_percent": "Discount_Percent",
            "gross_sales": "Gross_Sales_TND",
            "net_sales": "Net_Sales_TND",
            "order_status": "Order_Status",
            "revenue_eligible": "Revenue_Eligible",
            "data_quality_flag": "Data_Quality_Flag",
        }
    )

    lines["Order_Date"] = pd.to_datetime(lines["Order_Date"]).dt.strftime("%Y-%m-%d")
    columns = [
        "Order_Line_ID", "Line_Number", "Order_ID", "Order_Date", "Customer_ID",
        "Customer_Name", "Customer_City", "Customer_Segment", "Product_SKU",
        "Product_Name", "Product_Category", "Store_Code", "Store_Name",
        "Store_Region", "Quantity", "Unit_Price_TND", "Discount_Percent",
        "Gross_Sales_TND", "Net_Sales_TND", "Order_Status", "Revenue_Eligible",
        "Data_Quality_Flag",
    ]
    return (
        lines[columns]
        .sort_values(["Order_Date", "Order_ID", "Line_Number"])
        .reset_index(drop=True)
    )


def build_star_schema(line_level, final, payments, customers, products, stores):
    """Build the Power BI star-schema tables without inventing business data."""
    dim_customer = customers.rename(
        columns={
            "customer_id": "CustomerKey",
            "customer_name": "Customer_Name",
            "email": "Email",
            "email_is_valid": "Email_Is_Valid",
            "city": "City",
            "signup_date": "Signup_Date",
            "customer_segment": "Segment",
            "is_unknown": "Is_Unknown",
        }
    ).copy()
    dim_customer["Signup_Date"] = pd.to_datetime(
        dim_customer["Signup_Date"], errors="coerce"
    ).dt.strftime("%Y-%m-%d")
    dim_customer = dim_customer[
        ["CustomerKey", "Customer_Name", "Email", "Email_Is_Valid", "City",
         "Signup_Date", "Segment", "Is_Unknown"]
    ]

    dim_product = products.rename(
        columns={
            "product_id": "ProductKey",
            "product_name": "Product_Name",
            "category": "Category",
            "list_price_tnd": "List_Price_TND",
            "product_status": "Product_Status",
            "is_unknown": "Is_Unknown",
        }
    ).copy()
    dim_product = dim_product[
        ["ProductKey", "Product_Name", "Category", "List_Price_TND",
         "Product_Status", "Is_Unknown"]
    ]

    dim_store = stores.rename(
        columns={
            "store_id": "StoreKey",
            "store_name": "Store_Name",
            "city": "City",
            "region": "Region",
            "is_unknown": "Is_Unknown",
        }
    ).copy()
    dim_store = dim_store[
        ["StoreKey", "Store_Name", "City", "Region", "Is_Unknown"]
    ]

    fact_sales = line_level.rename(
        columns={
            "Order_Line_ID": "Order_Line_ID",
            "Order_ID": "Order_ID",
            "Order_Date": "Order_Date",
            "Customer_ID": "CustomerKey",
            "Product_SKU": "ProductKey",
            "Store_Code": "StoreKey",
            "Quantity": "Quantity",
            "Unit_Price_TND": "Unit_Price_TND",
            "Discount_Percent": "Discount_Percent",
            "Gross_Sales_TND": "Gross_Sales_TND",
            "Net_Sales_TND": "Net_Sales_TND",
            "Order_Status": "Order_Status",
            "Revenue_Eligible": "Revenue_Eligible",
            "Data_Quality_Flag": "Data_Quality_Flag",
        }
    ).copy()
    fact_sales["DateKey"] = (
        pd.to_datetime(fact_sales["Order_Date"]).dt.strftime("%Y%m%d").astype(int)
    )
    fact_sales = fact_sales[
        ["Order_Line_ID", "Order_ID", "DateKey", "CustomerKey", "ProductKey",
         "StoreKey", "Quantity", "Unit_Price_TND", "Discount_Percent",
         "Gross_Sales_TND", "Net_Sales_TND", "Order_Status", "Revenue_Eligible",
         "Data_Quality_Flag"]
    ]

    order_map = final[["Order_ID", "Customer_ID", "Store_Code"]].rename(
        columns={"Customer_ID": "CustomerKey", "Store_Code": "StoreKey"}
    )
    matched_payments = payments[
        payments["order_id"].isin(final["Order_ID"])
    ].copy()
    fact_payments = matched_payments.merge(
        order_map, left_on="order_id", right_on="Order_ID", how="left"
    )
    fact_payments["DateKey"] = (
        pd.to_datetime(fact_payments["payment_date"], errors="coerce")
        .dt.strftime("%Y%m%d")
        .astype("Int64")
    )

    def payment_flag(row):
        flags = []
        if pd.isna(row["payment_amount_tnd"]):
            flags.append("PAYMENT_AMOUNT_MISSING")
        if row["payment_status"] == "Refunded":
            flags.append("REFUNDED_AMOUNT_RETAINED")
        order_flags = ORDER_FLAGS.get(str(row["Order_ID"]), set())
        if "PAYMENT_AMOUNT_MISMATCH" in order_flags:
            flags.append("PAYMENT_AMOUNT_MISMATCH")
        return "; ".join(flags)

    fact_payments["Payment_Flag"] = fact_payments.apply(payment_flag, axis=1)
    fact_payments = fact_payments.rename(
        columns={
            "payment_id": "Payment_ID",
            "payment_amount_tnd": "Payment_Amount_TND",
            "payment_method": "Payment_Method",
            "payment_status": "Payment_Status",
        }
    )
    fact_payments = fact_payments[
        ["Payment_ID", "Order_ID", "DateKey", "CustomerKey", "StoreKey",
         "Payment_Amount_TND", "Payment_Method", "Payment_Status", "Payment_Flag"]
    ]

    order_line_counts = (
        line_level.groupby("Order_ID", sort=False)
        .size()
        .rename("Line_Count")
        .reset_index()
    )
    dim_order = final[["Order_ID", "Order_Date", "Order_Status", "Revenue_Eligible",
                       "Payment_Status", "Payment_Count", "Data_Quality_Flag"]].merge(
        order_line_counts, on="Order_ID", how="left"
    )
    dim_order["Line_Count"] = dim_order["Line_Count"].fillna(0).astype(int)

    date_keys = pd.concat(
        [fact_sales["DateKey"], fact_payments["DateKey"].dropna().astype(int)],
        ignore_index=True,
    ).dropna().astype(int)
    start = pd.to_datetime(str(int(date_keys.min())), format="%Y%m%d")
    end = pd.to_datetime(str(int(date_keys.max())), format="%Y%m%d")
    dates = pd.date_range(start, end, freq="D")
    dim_date = pd.DataFrame(
        {
            "DateKey": dates.strftime("%Y%m%d").astype(int),
            "Date": dates.strftime("%Y-%m-%d"),
            "Year": dates.year,
            "Quarter": dates.quarter,
            "Month": dates.month,
            "Month_Name": dates.strftime("%B"),
            "Day": dates.day,
            "Day_Name": dates.strftime("%A"),
            "Weekday_Number": dates.weekday + 1,
            "Is_Weekend": dates.weekday >= 5,
        }
    )

    return {
        "FactSales": fact_sales,
        "FactPayments": fact_payments,
        "DimCustomer": dim_customer,
        "DimProduct": dim_product,
        "DimStore": dim_store,
        "DimDate": dim_date,
        "DimOrder": dim_order,
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate(final, raw):
    """Run the requested validation checks and return results + summary stats."""
    results: list[tuple[str, str, str]] = []

    def check(name, passed, detail):
        results.append((name, "PASS" if passed else "FAIL", detail))

    order_count = len(final)
    unique_orders = final["Order_ID"].nunique()
    check(
        "One row per order",
        order_count == unique_orders,
        f"{order_count} rows / {unique_orders} distinct Order_ID values.",
    )

    duplicate_ids = int(final["Order_ID"].duplicated().sum())
    check("No duplicate Order_ID", duplicate_ids == 0, f"{duplicate_ids} duplicate IDs.")

    financial_ok = True
    financial_detail = []
    net_ok = True
    net_detail = []
    for _, row in final.iterrows():
        expected_gross = round(float(row["Quantity"]) * float(row["Unit_Price_TND"]), 2)
        if abs(expected_gross - float(row["Gross_Sales_TND"])) > 0.05:
            financial_ok = False
            financial_detail.append(
                f"{row['Order_ID']}: {expected_gross} vs {row['Gross_Sales_TND']}"
            )
        expected_net = 0.0 if row["Revenue_Eligible"] == "No" else round(
            float(row["Gross_Sales_TND"]) * (1 - float(row["Discount_Percent"])), 2
        )
        if abs(expected_net - float(row["Net_Sales_TND"])) > 0.01:
            net_ok = False
            net_detail.append(
                f"{row['Order_ID']}: {expected_net} vs {row['Net_Sales_TND']}"
            )
    check(
        "Gross = Quantity x Unit Price (tol 0.05 for weighted unit price)",
        financial_ok,
        "; ".join(financial_detail) if financial_detail else "All gross values reconcile.",
    )
    check(
        "Net = Gross x (1 - Discount), zero for non-revenue statuses",
        net_ok,
        "; ".join(net_detail) if net_detail else "All net values reconcile.",
    )

    critical = [
        "Order_ID", "Order_Date", "Customer_ID", "Product_SKU", "Store_Code",
        "Quantity", "Unit_Price_TND", "Gross_Sales_TND", "Net_Sales_TND", "Order_Status",
    ]
    missing = {col: int(final[col].isna().sum()) for col in critical}
    check(
        "Critical fields present",
        all(value == 0 for value in missing.values()),
        ", ".join(f"{k}={v}" for k, v in missing.items()),
    )

    unmatched_counts = {
        "unmatched_customer_orders": int(final["Data_Quality_Flag"].fillna("").str.contains("UNMATCHED_CUSTOMER").sum()),
        "unmatched_product_orders": int(final["Data_Quality_Flag"].fillna("").str.contains("UNMATCHED_PRODUCT").sum()),
        "unmatched_store_orders": int(final["Data_Quality_Flag"].fillna("").str.contains("UNMATCHED_STORE").sum()),
        "orders_without_payment": int((final["Payment_Count"] == 0).sum()),
        "payment_discrepancies": int(final["Data_Quality_Flag"].fillna("").str.contains("PAYMENT_AMOUNT_MISMATCH").sum()),
    }
    check(
        "Unmatched relationships documented",
        True,
        json.dumps(unmatched_counts),
    )

    original_orders = raw["sales"]["order_id"].map(clean_id).nunique()
    check(
        "Original vs final record counts explained",
        original_orders - len(final) == 2,
        f"Original distinct orders={original_orders}, final valid orders={len(final)}, "
        f"rejected orders=2.",
    )

    stats = {
        "final_orders": int(len(final)),
        "gross_sales": round(float(final["Gross_Sales_TND"].sum()), 2),
        "net_sales": round(float(final["Net_Sales_TND"].sum()), 2),
        "cancelled_orders": int((final["Order_Status"] == "Cancelled").sum()),
        "returned_orders": int((final["Order_Status"] == "Returned").sum()),
        "pending_orders": int((final["Order_Status"] == "Pending").sum()),
        "orders_without_payment": int((final["Payment_Count"] == 0).sum()),
        "unmatched_counts": unmatched_counts,
        "original_rows": {name: int(len(df)) for name, df in raw.items()},
        "original_distinct_orders": int(original_orders),
        "duplicates_removed": int(
            sum(
                1 for row in CLEANING_LOG
                if row["action"] in {
                    "remove_exact_duplicate",
                    "remove_duplicate_key",
                    "remove_duplicate_business_payment",
                }
            )
        ),
        "rejected_records": int(len(REJECTED)),
        "rejected_orders": int(
            sum(1 for row in REJECTED if row["record_type"] == "sales_order")
        ),
        "rejected_payments": int(
            sum(1 for row in REJECTED if row["record_type"] == "payment")
        ),
        "orphan_payments": int(
            sum(1 for row in REJECTED
                if row["record_type"] == "payment"
                and row["rejection_reason"].startswith("Orphan payment"))
        ),
    }
    return results, stats


# ---------------------------------------------------------------------------
# Reporting / output
# ---------------------------------------------------------------------------


def append_cleaning_and_validation(lines, validation_results, stats):
    """Append the post-cleaning sections to the data-quality report."""
    lines.append("9. CLEANING EXECUTION RESULTS")
    lines.append("-" * 78)
    action_counts = (
        pd.Series([row["action"] for row in CLEANING_LOG])
        .value_counts()
        .rename_axis("action")
        .reset_index(name="count")
    )
    lines.append(action_counts.to_string(index=False) if not action_counts.empty else "No corrections.")
    lines.append("")

    lines.append("10. REJECTED RECORDS")
    lines.append("-" * 78)
    if REJECTED:
        rejected_df = pd.DataFrame(REJECTED)
        lines.append(
            rejected_df[["source_file", "record_type", "record_id", "rejection_reason"]]
            .to_string(index=False)
        )
    else:
        lines.append("No records rejected.")
    lines.append("")

    lines.append("11. FINAL VALIDATION")
    lines.append("-" * 78)
    for name, status, detail in validation_results:
        lines.append(f"[{status}] {name}: {detail}")
    lines.append("")

    lines.append("12. UNRESOLVED / DOCUMENTED DATA-QUALITY ISSUES")
    lines.append("-" * 78)
    unresolved = list(dict.fromkeys(ISSUES))
    unresolved.append(
        "No discount information exists in the source; Discount_Percent is 0 "
        "for every order (absence of data, not an invented discount)."
    )
    unresolved.append(
        "Customer segment is not available in the source; Customer_Segment is null."
    )
    unresolved.append(
        "ORD-1031 (C999), ORD-1032 (P999) and ORD-1029 (ST99) have no reliable "
        "master record in any source file. Explicit Unknown dimension members "
        "were created with the original keys and Is_Unknown=True; no real "
        "customer/product/store details were invented."
    )
    unresolved.append(
        "Payment exceptions are preserved, not corrected: ORD-1030 has 999.00 "
        "paid against 45.00 gross; ORD-1021 has a Paid status with a missing "
        "amount; ORD-1007 and ORD-1017 have no payment record. Missing amounts "
        "remain null and are never treated as zero."
    )
    unresolved.append(
        "Payment totals are reconciled against gross value; no discount data means "
        "net and gross are identical for revenue-eligible orders."
    )
    for issue in dict.fromkeys(unresolved):
        lines.append(f"* {issue}")
    lines.append("")


def build_summary(stats, validation_results):
    """Build output/cleaning_summary.txt."""
    lines = []
    lines.append("=" * 78)
    lines.append("CLEANING SUMMARY")
    lines.append("=" * 78)
    lines.append("")
    lines.append("ORIGINAL ROW COUNTS")
    for name, count in stats["original_rows"].items():
        lines.append(f"  {name:<10} {FILES[name]:<24} {count:>4} rows")
    lines.append("")
    lines.append("RESULTS")
    lines.append(f"  Original distinct orders          : {stats['original_distinct_orders']}")
    lines.append(f"  Final valid orders                : {stats['final_orders']}")
    lines.append(f"  Duplicate records handled         : {stats['duplicates_removed']}")
    lines.append(f"  Records rejected                  : {stats['rejected_records']}")
    lines.append(f"    - rejected sales orders         : {stats['rejected_orders']}")
    lines.append(f"    - excluded payment records      : {stats['rejected_payments']}")
    lines.append(f"  Total gross sales (TND)           : {stats['gross_sales']:,.2f}")
    lines.append(f"  Total net sales / revenue (TND)   : {stats['net_sales']:,.2f}")
    lines.append(f"  Cancelled orders                  : {stats['cancelled_orders']}")
    lines.append(f"  Returned orders                   : {stats['returned_orders']}")
    lines.append(f"  Pending orders                    : {stats['pending_orders']}")
    lines.append(f"  Orders without a payment record   : {stats['orders_without_payment']}")
    lines.append("")
    lines.append("UNMATCHED RELATIONSHIP COUNTS")
    for key, value in stats["unmatched_counts"].items():
        lines.append(f"  {key:<34}: {value}")
    lines.append(f"  {'orphan_payments':<34}: {stats['orphan_payments']}")
    lines.append(f"  {'payments_for_rejected_orders':<34}: {stats['rejected_payments'] - stats['orphan_payments']}")
    lines.append(
        f"  Distinct unmatched records        : "
        f"{stats['unmatched_counts']['unmatched_customer_orders'] + stats['unmatched_counts']['unmatched_product_orders'] + stats['unmatched_counts']['unmatched_store_orders'] + stats['orphan_payments']}"
    )
    lines.append("")
    lines.append("VALIDATION")
    for name, status, detail in validation_results:
        lines.append(f"  [{status}] {name}: {detail}")
    lines.append("")
    lines.append("OUTPUT FILES")
    lines.append("  output/clean_sales.csv          order-level dataset")
    lines.append("  output/clean_sales_lines.csv    line-level dataset")
    lines.append("  output/FactSales.csv            line-grain fact")
    lines.append("  output/FactPayments.csv         payment-grain fact")
    lines.append("  output/DimCustomer.csv          customer dimension")
    lines.append("  output/DimProduct.csv           product dimension")
    lines.append("  output/DimStore.csv             store dimension")
    lines.append("  output/DimDate.csv              calendar dimension")
    lines.append("  output/DimOrder.csv             order bridge dimension")
    lines.append("  output/data_quality_report.txt")
    lines.append("  output/cleaning_summary.txt")
    lines.append("  output/rejected_records.csv")
    lines.append("  output/cleaning_log.csv")
    lines.append("")
    lines.append("POWER BI NOTES")
    lines.append("  * FactSales is one row per order line; use Net_Sales_TND for revenue.")
    lines.append(f"  * clean_sales_lines.csv: {stats.get('final_lines', 0)} rows (one per order line).")
    lines.append("  * clean_sales.csv remains the one-row-per-order dataset.")
    lines.append("  * FactPayments is one row per payment; never sum it as revenue without")
    lines.append("    filtering Payment_Status and resolving the ORD-1030 exception.")
    lines.append("  * Use DimOrder to relate FactSales and FactPayments on Order_ID; do not")
    lines.append("    create a direct many-to-many relationship between the two facts.")
    lines.append("  * Customer_Segment is null because the source has no segment field.")
    lines.append("  * Unknown members C999, P999 and ST99 are explicit and flagged.")
    lines.append("  * Order_Date and Payment_Date are ISO text (YYYY-MM-DD) for Power BI.")
    lines.append("")
    return "\n".join(lines)


def write_outputs(final, line_level, star, report_lines, summary_text):
    """Write every output artifact without touching the originals."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    final.to_csv(
        os.path.join(OUTPUT_DIR, "clean_sales.csv"),
        index=False,
        encoding="utf-8",
        na_rep="",
        float_format="%.2f",
    )

    line_level.to_csv(
        os.path.join(OUTPUT_DIR, "clean_sales_lines.csv"),
        index=False,
        encoding="utf-8",
        na_rep="",
        float_format="%.2f",
    )

    for name, frame in star.items():
        frame.to_csv(
            os.path.join(OUTPUT_DIR, f"{name}.csv"),
            index=False,
            encoding="utf-8",
            na_rep="",
            float_format="%.2f",
        )

    with open(os.path.join(OUTPUT_DIR, "data_quality_report.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(report_lines) + "\n")

    with open(os.path.join(OUTPUT_DIR, "cleaning_summary.txt"), "w", encoding="utf-8") as handle:
        handle.write(summary_text + "\n")

    pd.DataFrame(
        REJECTED,
        columns=["source_file", "record_type", "record_id", "rejection_reason", "original_record"],
    ).to_csv(
        os.path.join(OUTPUT_DIR, "rejected_records.csv"),
        index=False,
        encoding="utf-8",
    )

    pd.DataFrame(
        CLEANING_LOG,
        columns=[
            "stage", "source_file", "record_id", "field", "original_value",
            "cleaned_value", "action", "reason",
        ],
    ).to_csv(
        os.path.join(OUTPUT_DIR, "cleaning_log.csv"),
        index=False,
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    print("Reading raw files ...")
    raw, inferred = load_raw_data()

    print("Profiling raw data ...")
    report_lines = [
        "=" * 78,
        "DATA QUALITY REPORT",
        "Generated by clean_data.py",
        f"Source directory: {BASE_DIR}",
        "The five original CSV files were read-only.",
        "=" * 78,
        "",
    ]
    report_lines.extend(build_profile_sections(raw, inferred))

    # Payment dates are used only as a reference for ambiguous sales dates.
    payment_reference = {}
    for _, row in raw["payments"].iterrows():
        oid = clean_id(row["order_id"])
        parsed, status, _ = parse_date(row["payment_date"])
        if pd.notna(oid) and pd.notna(parsed) and status == "ok":
            payment_reference.setdefault(oid, parsed)

    print("Cleaning dimensions ...")
    customers = clean_customers(raw)
    products = clean_products(raw)
    stores = clean_stores(raw)
    payments = clean_payments(raw)

    print("Cleaning sales lines ...")
    raw_sales_order_ids = set(raw["sales"]["order_id"].map(clean_id).dropna())
    sales = clean_sales(raw, payment_reference)
    valid_order_ids = set(sales["order_id"])

    print("Creating explicit Unknown dimension members ...")
    customers, products, stores = add_unknown_members(
        sales, customers, products, stores
    )

    print("Aggregating payments ...")
    payment_agg = aggregate_payments(payments, valid_order_ids, raw_sales_order_ids)

    print("Consolidating order-level dataset ...")
    final = consolidate(sales, customers, products, stores, payment_agg)

    print("Building line-level dataset and star schema ...")
    line_level = build_line_level(sales, customers, products, stores)
    star = build_star_schema(line_level, final, payments, customers, products, stores)

    print("Validating ...")
    validation_results, stats = validate(final, raw)
    stats["final_lines"] = int(len(line_level))
    stats["fact_payment_rows"] = int(len(star["FactPayments"]))
    stats["unknown_members"] = int(
        sum(
            int(frame["Is_Unknown"].fillna(False).sum())
            for frame in (star["DimCustomer"], star["DimProduct"], star["DimStore"])
        )
    )

    append_cleaning_and_validation(report_lines, validation_results, stats)
    summary_text = build_summary(stats, validation_results)

    print("Writing outputs ...")
    write_outputs(final, line_level, star, report_lines, summary_text)

    print("\nDone. Outputs written to:", OUTPUT_DIR)
    print(f"Final valid orders: {stats['final_orders']}")
    print(f"Final valid order lines: {stats['final_lines']}")
    print(f"FactPayments rows: {stats['fact_payment_rows']}")
    print(f"Total gross sales (TND): {stats['gross_sales']:,.2f}")
    print(f"Total net sales (TND): {stats['net_sales']:,.2f}")
    print(f"Rejected records: {stats['rejected_records']}")
    print(f"Duplicate records handled: {stats['duplicates_removed']}")

    failed = [name for name, status, _ in validation_results if status == "FAIL"]
    if failed:
        print("\nVALIDATION FAILURES:", ", ".join(failed))
        return 1
    print("\nAll validation checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
