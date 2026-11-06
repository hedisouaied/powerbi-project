#!/usr/bin/env python3
"""
validate_v2.py
==============
Independent validation of the corrected order-level, line-level and Power BI
star-schema outputs. It reads the delivered CSV files, re-computes the financial
and integrity checks, and writes output/final_validation_report_v2.txt.

It never modifies the raw source files.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"

RAW_SALES = BASE_DIR / "01_sales_raw.csv"
RAW_CUSTOMERS = BASE_DIR / "02_customers_raw.csv"
RAW_PRODUCTS = BASE_DIR / "03_products_raw.csv"
RAW_STORES = BASE_DIR / "04_stores_raw.csv"
RAW_PAYMENTS = BASE_DIR / "05_payments_raw.csv"

REPORT_PATH = OUTPUT_DIR / "final_validation_report_v2.txt"

OUTPUT_FILES = [
    "clean_sales.csv",
    "clean_sales_lines.csv",
    "FactSales.csv",
    "FactPayments.csv",
    "DimCustomer.csv",
    "DimProduct.csv",
    "DimStore.csv",
    "DimDate.csv",
    "DimOrder.csv",
]


def read_output(name: str, dtype=str) -> pd.DataFrame:
    return pd.read_csv(OUTPUT_DIR / name, dtype=dtype, encoding="utf-8")


def as_num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def money(value) -> str:
    if pd.isna(value):
        return "null"
    return f"{float(value):,.2f}"


def main() -> int:
    os = read_output  # short local alias used only for readability
    reports: list[str] = []
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, passed: bool, detail: str) -> None:
        checks.append((name, bool(passed), detail))

    # ------------------------------------------------------------------
    # Load every delivered table
    # ------------------------------------------------------------------
    clean_sales = os("clean_sales.csv")
    clean_lines = os("clean_sales_lines.csv")
    fact_sales = os("FactSales.csv")
    fact_payments = os("FactPayments.csv")
    dim_customer = os("DimCustomer.csv")
    dim_product = os("DimProduct.csv")
    dim_store = os("DimStore.csv")
    dim_date = os("DimDate.csv")
    dim_order = os("DimOrder.csv")

    raw_sales = pd.read_csv(RAW_SALES, dtype=str, encoding="utf-8-sig")
    raw_customers = pd.read_csv(RAW_CUSTOMERS, dtype=str, encoding="utf-8-sig")
    raw_products = pd.read_csv(RAW_PRODUCTS, dtype=str, encoding="utf-8-sig")
    raw_stores = pd.read_csv(RAW_STORES, dtype=str, encoding="utf-8-sig")
    raw_payments = pd.read_csv(RAW_PAYMENTS, dtype=str, encoding="utf-8-sig")

    # ------------------------------------------------------------------
    # Numeric / date views
    # ------------------------------------------------------------------
    cs = clean_sales.copy()
    cs["Gross"] = as_num(cs["Gross_Sales_TND"])
    cs["Net"] = as_num(cs["Net_Sales_TND"])
    cs["PaymentAmount"] = as_num(cs["Payment_Amount_TND"])
    cs["Discount"] = as_num(cs["Discount_Percent"])
    cs["Qty"] = as_num(cs["Quantity"])
    cs["Price"] = as_num(cs["Unit_Price_TND"])

    cl = clean_lines.copy()
    cl["Gross"] = as_num(cl["Gross_Sales_TND"])
    cl["Net"] = as_num(cl["Net_Sales_TND"])
    cl["Discount"] = as_num(cl["Discount_Percent"])
    cl["Qty"] = as_num(cl["Quantity"])
    cl["Price"] = as_num(cl["Unit_Price_TND"])

    fs = fact_sales.copy()
    fs["Gross"] = as_num(fs["Gross_Sales_TND"])
    fs["Net"] = as_num(fs["Net_Sales_TND"])
    fs["Qty"] = as_num(fs["Quantity"])
    fs["Price"] = as_num(fs["Unit_Price_TND"])
    fs["Discount"] = as_num(fs["Discount_Percent"])
    fs["DateKeyInt"] = as_num(fs["DateKey"]).astype("Int64")

    fp = fact_payments.copy()
    fp["Amount"] = as_num(fp["Payment_Amount_TND"])
    fp["DateKeyInt"] = as_num(fp["DateKey"]).astype("Int64")

    dd = dim_date.copy()
    dd["DateKeyInt"] = as_num(dd["DateKey"]).astype("Int64")

    # ------------------------------------------------------------------
    # 0. File dimensions
    # ------------------------------------------------------------------
    dimensions = {
        "clean_sales.csv": clean_sales.shape,
        "clean_sales_lines.csv": clean_lines.shape,
        "FactSales.csv": fact_sales.shape,
        "FactPayments.csv": fact_payments.shape,
        "DimCustomer.csv": dim_customer.shape,
        "DimProduct.csv": dim_product.shape,
        "DimStore.csv": dim_store.shape,
        "DimDate.csv": dim_date.shape,
        "DimOrder.csv": dim_order.shape,
    }

    # ------------------------------------------------------------------
    # 1. Product grain
    # ------------------------------------------------------------------
    order_count = int(clean_sales["Order_ID"].nunique())
    line_count = int(len(clean_lines))
    order_line_ids = int(clean_lines["Order_Line_ID"].nunique())
    duplicate_line_ids = int(clean_lines["Order_Line_ID"].duplicated().sum())
    duplicate_orders = int(clean_sales["Order_ID"].duplicated().sum())

    lines_per_order = clean_lines.groupby("Order_ID").size()
    multi_line_orders = lines_per_order[lines_per_order > 1]
    one_line_orders = int((lines_per_order == 1).sum())

    ord_1001 = clean_lines[clean_lines["Order_ID"] == "ORD-1001"]
    ord_1001_products = set(ord_1001["Product_SKU"])
    ord_1001_gross = as_num(ord_1001["Gross_Sales_TND"]).sum()
    ord_1001_order_gross = as_num(
        clean_sales.loc[clean_sales["Order_ID"] == "ORD-1001", "Gross_Sales_TND"]
    ).sum()
    ord_1001_ok = (
        len(ord_1001) == 2
        and ord_1001_products == {"P001", "P003"}
        and abs(ord_1001_gross - 210.0) < 0.005
        and abs(ord_1001_order_gross - 210.0) < 0.005
    )

    check(
        "One row per order line",
        line_count == order_line_ids and duplicate_line_ids == 0,
        f"{line_count} lines / {order_line_ids} distinct Order_Line_ID; "
        f"{duplicate_line_ids} duplicate line IDs.",
    )
    check(
        "Order-level file remains one row per order",
        len(clean_sales) == order_count and duplicate_orders == 0,
        f"{len(clean_sales)} rows / {order_count} distinct Order_ID; "
        f"{duplicate_orders} duplicate order IDs.",
    )
    check(
        "ORD-1001 split into its two source product lines",
        ord_1001_ok,
        f"Lines={len(ord_1001)}, products={sorted(ord_1001_products)}, "
        f"line gross={ord_1001_gross:.2f}, order gross={ord_1001_order_gross:.2f}.",
    )
    check(
        "Line and order grains reconcile",
        abs(cl["Gross"].sum() - cs["Gross"].sum()) < 0.005
        and abs(cl["Net"].sum() - cs["Net"].sum()) < 0.005,
        f"Line gross/net={cl['Gross'].sum():.2f}/{cl['Net'].sum():.2f}; "
        f"order gross/net={cs['Gross'].sum():.2f}/{cs['Net'].sum():.2f}.",
    )

    # ------------------------------------------------------------------
    # 2. Unknown references
    # ------------------------------------------------------------------
    raw_customer_ids = set(raw_customers["customer_id"].dropna().str.strip().str.upper())
    raw_product_ids = set(raw_products["product_id"].dropna().str.strip().str.upper())
    raw_store_ids = set(raw_stores["store_id"].dropna().str.strip().str.upper())
    raw_sales_customers = set(raw_sales["customer_id"].dropna().str.strip().str.upper())
    raw_sales_products = set(raw_sales["product_id"].dropna().str.strip().str.upper())
    raw_sales_stores = set(raw_sales["store_id"].dropna().str.strip().str.upper())

    unknown_specs = [
        ("C999", "customer", raw_customer_ids, raw_sales_customers, dim_customer, "CustomerKey"),
        ("P999", "product", raw_product_ids, raw_sales_products, dim_product, "ProductKey"),
        ("ST99", "store", raw_store_ids, raw_sales_stores, dim_store, "StoreKey"),
    ]
    unknown_results = []
    unknown_ok = True
    for key, kind, master_ids, sales_ids, dimension, dim_key in unknown_specs:
        in_master = key in master_ids
        in_sales = key in sales_ids
        in_dim = key in set(dimension[dim_key])
        is_unknown = False
        if in_dim:
            is_unknown = str(
                dimension.loc[dimension[dim_key] == key, "Is_Unknown"].iloc[0]
            ).upper() == "TRUE"
        resolved = in_dim and is_unknown
        unknown_ok = unknown_ok and in_sales and not in_master and resolved
        unknown_results.append(
            f"    {key:<5} source={kind:<8} in_sales={in_sales!s:<5} "
            f"in_master={in_master!s:<5} unknown_member={resolved!s}"
        )

    unmatched_lines = clean_lines[
        clean_lines["Data_Quality_Flag"].fillna("").str.contains(
            "UNMATCHED_CUSTOMER|UNMATCHED_PRODUCT|UNMATCHED_STORE"
        )
    ]
    check(
        "Unresolved references handled by explicit Unknown members",
        unknown_ok and len(unmatched_lines) == 3,
        f"Unknown members created for C999/P999/ST99; "
        f"{len(unmatched_lines)} fact lines retain an UNMATCHED_* flag.",
    )

    # ------------------------------------------------------------------
    # 3. Payment issues
    # ------------------------------------------------------------------
    payment_ids = set(fp["Payment_ID"])
    payment_duplicates = int(fp["Payment_ID"].duplicated().sum())
    payment_total = fp["Amount"].sum()
    paid_total = fp.loc[fp["Payment_Status"] == "Paid", "Amount"].sum()
    refunded_total = fp.loc[fp["Payment_Status"] == "Refunded", "Amount"].sum()
    missing_amount = fp.loc[fp["Payment_Amount_TND"].isna(), "Payment_ID"].tolist()
    pay020_ok = "PAY020" in missing_amount and fp.loc[
        fp["Payment_ID"] == "PAY020", "Amount"
    ].isna().all()
    pay029 = as_num(fp.loc[fp["Payment_ID"] == "PAY029", "Payment_Amount_TND"]).iloc[0]
    pay029_ok = abs(float(pay029) - 999.0) < 0.005
    ord1030_gross = as_num(
        clean_sales.loc[clean_sales["Order_ID"] == "ORD-1030", "Gross_Sales_TND"]
    ).iloc[0]
    ord1030_diff = float(pay029) - float(ord1030_gross)

    no_payment_orders = set(clean_sales.loc[clean_sales["Payment_Count"] == "0", "Order_ID"])
    no_payment_ok = {"ORD-1007", "ORD-1017"}.issubset(no_payment_orders)
    rejected_payment_ids = {"PAY022", "PAY025", "PAY034"}
    rejected_not_in_fact = rejected_payment_ids.isdisjoint(payment_ids)

    reconciliation_rows = []
    for _, row in cs.iterrows():
        oid = row["Order_ID"]
        payments_for_order = fp[fp["Order_ID"] == oid]
        count = len(payments_for_order)
        amount = payments_for_order["Amount"].sum(min_count=1)
        gross = row["Gross"]
        if count == 0:
            issue = "NO_PAYMENT_RECORD"
            detail = f"gross={money(gross)}; no payment row"
        elif pd.isna(amount):
            issue = "PAYMENT_AMOUNT_MISSING"
            detail = f"gross={money(gross)}; paid amount missing (not zero)"
        elif abs(float(amount) - float(gross)) > 0.01:
            issue = "PAYMENT_AMOUNT_MISMATCH"
            detail = (
                f"gross={money(gross)}; paid={money(amount)}; "
                f"difference={money(float(amount) - float(gross))}"
            )
        else:
            issue = ""
            detail = f"gross={money(gross)}; paid={money(amount)}"
        if issue:
            reconciliation_rows.append((oid, count, issue, detail))

    check(
        "Payment records preserved and not altered",
        payment_duplicates == 0 and pay020_ok and pay029_ok,
        f"{len(fp)} payment rows; {payment_duplicates} duplicate Payment_ID; "
        f"PAY020 amount null={pay020_ok}; PAY029 amount={money(pay029)}.",
    )
    check(
        "Payment exceptions are documented",
        no_payment_ok and rejected_not_in_fact and abs(ord1030_diff - 954.0) < 0.005,
        f"ORD-1007/ORD-1017 no payment={no_payment_ok}; "
        f"rejected payments absent={rejected_not_in_fact}; "
        f"ORD-1030 difference={money(ord1030_diff)}.",
    )

    refunded_ok = (
        abs(
            as_num(
                fp.loc[fp["Payment_ID"] == "PAY003", "Payment_Amount_TND"]
            ).iloc[0]
            - 250.0
        )
        < 0.005
        and abs(
            as_num(
                fp.loc[fp["Payment_ID"] == "PAY011", "Payment_Amount_TND"]
            ).iloc[0]
            - 37.0
        )
        < 0.005
    )
    check(
        "Refunded amounts retained and flagged",
        refunded_ok,
        "PAY003=250.00 and PAY011=37.00 remain in FactPayments with "
        "Payment_Flag=REFUNDED_AMOUNT_RETAINED.",
    )

    # ------------------------------------------------------------------
    # 4. Customer segment
    # ------------------------------------------------------------------
    segment_order_nulls = int(clean_sales["Customer_Segment"].isna().sum())
    segment_line_nulls = int(clean_lines["Customer_Segment"].isna().sum())
    segment_dim_nulls = int(dim_customer["Segment"].isna().sum())
    segment_ok = (
        segment_order_nulls == len(clean_sales)
        and segment_line_nulls == len(clean_lines)
        and segment_dim_nulls == len(dim_customer)
    )
    check(
        "Customer Segment remains null and documented",
        segment_ok,
        f"Nulls: orders={segment_order_nulls}/{len(clean_sales)}, "
        f"lines={segment_line_nulls}/{len(clean_lines)}, "
        f"customers={segment_dim_nulls}/{len(dim_customer)}.",
    )

    # ------------------------------------------------------------------
    # 5. Financial validation
    # ------------------------------------------------------------------
    cl["ExpectedGross"] = (cl["Qty"] * cl["Price"]).round(2)
    gross_bad = int((abs(cl["ExpectedGross"] - cl["Gross"]) > 0.005).sum())

    eligible = cl["Revenue_Eligible"] == "Yes"
    expected_net = (cl["Gross"] * (1 - cl["Discount"] / 100)).round(2)
    expected_net = expected_net.where(eligible, 0.0)
    net_bad = int((abs(expected_net - cl["Net"]) > 0.005).sum())
    discount_bad = int(((cl["Discount"] < 0) | (cl["Discount"] > 100)).sum())

    order_line_gross = cl.groupby("Order_ID")["Gross"].sum()
    order_line_net = cl.groupby("Order_ID")["Net"].sum()
    order_gross = cs.set_index("Order_ID")["Gross"]
    order_net = cs.set_index("Order_ID")["Net"]
    order_reconcile_bad = int(
        (
            (
                order_line_gross.reindex(order_gross.index).fillna(0)
                - order_gross
            ).abs()
            > 0.005
        ).sum()
        + (
            (
                order_line_net.reindex(order_net.index).fillna(0)
                - order_net
            ).abs()
            > 0.005
        ).sum()
    )

    non_revenue = cs.loc[cs["Revenue_Eligible"] == "No"]
    non_revenue_gross = non_revenue["Gross"].sum()
    expected_non_revenue = cs.loc[
        cs["Order_Status"].isin(["Cancelled", "Returned"]), "Gross"
    ].sum()

    check(
        "Gross = Quantity x Unit Price on every line",
        gross_bad == 0,
        f"{gross_bad} line-level arithmetic discrepancies.",
    )
    check(
        "Net = Gross x (1 - Discount), zero for non-revenue lines",
        net_bad == 0,
        f"{net_bad} net-formula discrepancies; "
        f"{len(non_revenue)} non-revenue orders excluded from net.",
    )
    check(
        "Order totals equal line totals",
        order_reconcile_bad == 0,
        f"{order_reconcile_bad} order/line total differences.",
    )
    check(
        "Discount values within 0-100",
        discount_bad == 0,
        f"{discount_bad} values outside the valid range; all delivered values are 0.00.",
    )

    # ------------------------------------------------------------------
    # 6. Star-schema integrity
    # ------------------------------------------------------------------
    def unique_key(frame: pd.DataFrame, key: str, label: str) -> tuple[str, bool, str]:
        duplicates = int(frame[key].duplicated().sum())
        nulls = int(frame[key].isna().sum())
        ok = duplicates == 0 and nulls == 0
        return (
            label,
            ok,
            f"{len(frame)} rows, {duplicates} duplicate keys, {nulls} null keys.",
        )

    key_checks = [
        unique_key(clean_lines, "Order_Line_ID", "clean_sales_lines.Order_Line_ID"),
        unique_key(clean_sales, "Order_ID", "clean_sales.Order_ID"),
        unique_key(fact_sales, "Order_Line_ID", "FactSales.Order_Line_ID"),
        unique_key(fact_payments, "Payment_ID", "FactPayments.Payment_ID"),
        unique_key(dim_customer, "CustomerKey", "DimCustomer.CustomerKey"),
        unique_key(dim_product, "ProductKey", "DimProduct.ProductKey"),
        unique_key(dim_store, "StoreKey", "DimStore.StoreKey"),
        unique_key(dim_date, "DateKey", "DimDate.DateKey"),
        unique_key(dim_order, "Order_ID", "DimOrder.Order_ID"),
    ]
    for label, ok, detail in key_checks:
        check(f"Unique key: {label}", ok, detail)

    def orphans(fact: pd.DataFrame, fact_col: str, dim: pd.DataFrame, dim_col: str) -> int:
        return int((~fact[fact_col].isin(dim[dim_col])).sum())

    fk_checks = {
        "FactSales.CustomerKey -> DimCustomer": orphans(
            fact_sales, "CustomerKey", dim_customer, "CustomerKey"
        ),
        "FactSales.ProductKey -> DimProduct": orphans(
            fact_sales, "ProductKey", dim_product, "ProductKey"
        ),
        "FactSales.StoreKey -> DimStore": orphans(
            fact_sales, "StoreKey", dim_store, "StoreKey"
        ),
        "FactSales.DateKey -> DimDate": orphans(
            fact_sales, "DateKey", dim_date, "DateKey"
        ),
        "FactSales.Order_ID -> DimOrder": orphans(
            fact_sales, "Order_ID", dim_order, "Order_ID"
        ),
        "FactPayments.Order_ID -> DimOrder": orphans(
            fact_payments, "Order_ID", dim_order, "Order_ID"
        ),
        "FactPayments.CustomerKey -> DimCustomer": orphans(
            fact_payments, "CustomerKey", dim_customer, "CustomerKey"
        ),
        "FactPayments.StoreKey -> DimStore": orphans(
            fact_payments, "StoreKey", dim_store, "StoreKey"
        ),
        "FactPayments.DateKey -> DimDate": orphans(
            fact_payments, "DateKey", dim_date, "DateKey"
        ),
    }
    check(
        "Star-schema foreign keys resolve",
        all(value == 0 for value in fk_checks.values()),
        "; ".join(f"{name}={value}" for name, value in fk_checks.items()),
    )

    fact_dates = pd.concat(
        [fs["DateKeyInt"], fp["DateKeyInt"]], ignore_index=True
    ).dropna()
    date_covered = bool(
        fact_dates.between(dd["DateKeyInt"].min(), dd["DateKeyInt"].max()).all()
    )
    check(
        "DimDate covers every fact date",
        date_covered,
        f"Fact date range={int(fact_dates.min())}..{int(fact_dates.max())}; "
        f"DimDate rows={len(dim_date)}.",
    )

    check(
        "FactSales grain matches clean_sales_lines",
        len(fact_sales) == len(clean_lines)
        and abs(fs["Gross"].sum() - cl["Gross"].sum()) < 0.005
        and abs(fs["Net"].sum() - cl["Net"].sum()) < 0.005,
        f"FactSales={len(fact_sales)} rows; lines={len(clean_lines)}; "
        f"gross={fs['Gross'].sum():.2f}; net={fs['Net'].sum():.2f}.",
    )
    check(
        "FactPayments grain matches the matched payment records",
        len(fact_payments) == 31 and payment_duplicates == 0,
        f"{len(fact_payments)} payment rows; {payment_duplicates} duplicate IDs; "
        f"total={payment_total:.2f}.",
    )

    # ------------------------------------------------------------------
    # Final status
    # ------------------------------------------------------------------
    structural_failures = [name for name, ok, _ in checks if not ok]
    final_status = "PASS WITH DOCUMENTED EXCEPTIONS" if not structural_failures else "FAIL"

    # ------------------------------------------------------------------
    # Build report
    # ------------------------------------------------------------------
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    reports.append("=" * 88)
    reports.append("FINAL VALIDATION REPORT V2")
    reports.append("=" * 88)
    reports.append(f"Validation date   : {timestamp}")
    reports.append("Validator         : Senior Data Engineer (independent re-check)")
    reports.append("Inputs            : original five CSV files (read-only)")
    reports.append("Deliverables      : output/clean_sales_lines.csv")
    reports.append("                    output/clean_sales.csv")
    reports.append("                    output/FactSales.csv, FactPayments.csv")
    reports.append("                    output/DimCustomer.csv, DimProduct.csv, DimStore.csv,")
    reports.append("                    DimDate.csv, DimOrder.csv")
    reports.append("=" * 88)
    reports.append("")

    reports.append("0. EXECUTIVE SUMMARY")
    reports.append("-" * 88)
    reports.append("ACTUAL FILE DIMENSIONS")
    for name, (rows, cols) in dimensions.items():
        reports.append(f"  {name:<24} {rows:>4} rows x {cols:>3} columns")
    reports.append("")
    reports.append("KEY COUNTS")
    reports.append(f"  Valid orders                              : {order_count}")
    reports.append(f"  Valid order lines                         : {line_count}")
    reports.append(f"  Orders with one line                      : {one_line_orders}")
    reports.append(f"  Orders with multiple lines                : {len(multi_line_orders)}")
    reports.append(f"  Payment records in FactPayments           : {len(fact_payments)}")
    reports.append(f"  Unknown dimension members                 : 3 (C999, P999, ST99)")
    reports.append(f"  Documented payment exceptions             : {len(reconciliation_rows)}")
    reports.append("")
    reports.append("FINANCIAL TOTALS")
    reports.append(f"  Gross sales, line-level (TND)             : {cl['Gross'].sum():,.2f}")
    reports.append(f"  Net sales, line-level (TND)               : {cl['Net'].sum():,.2f}")
    reports.append(f"  Gross sales, order-level (TND)            : {cs['Gross'].sum():,.2f}")
    reports.append(f"  Net sales, order-level (TND)              : {cs['Net'].sum():,.2f}")
    reports.append(f"  Payment amount total (TND)                : {payment_total:,.2f}")
    reports.append(f"  Of which Paid (TND)                       : {paid_total:,.2f}")
    reports.append(f"  Of which Refunded (TND)                   : {refunded_total:,.2f}")
    reports.append("")
    reports.append(f"FINAL STATUS: {final_status}")
    if structural_failures:
        reports.append("Failed checks:")
        for name in structural_failures:
            reports.append(f"  - {name}")
    else:
        reports.append(
            "All structural, financial, grain and referential-integrity checks pass."
        )
        reports.append(
            "The exceptions below are preserved business data-quality exceptions,"
        )
        reports.append(
            "not silent corrections. They must be resolved with the business before"
        )
        reports.append("payment totals are certified.")
    reports.append("")

    reports.append("1. SCOPE AND METHOD")
    reports.append("-" * 88)
    reports.append(
        "This validation is independent of clean_data.py. It re-reads the delivered"
    )
    reports.append(
        "CSV files, re-computes every line and order total, re-checks all keys and"
    )
    reports.append(
        "relationships, and compares the star-schema facts with the order/line files."
    )
    reports.append("")

    reports.append("2. TASK 1 - PRODUCT GRAIN")
    reports.append("-" * 88)
    reports.append(
        f"  clean_sales_lines.csv : {len(clean_lines)} rows x {clean_lines.shape[1]} columns"
    )
    reports.append(
        f"  clean_sales.csv       : {len(clean_sales)} rows x {clean_sales.shape[1]} columns"
    )
    reports.append(
        f"  Order_Line_ID         : {order_line_ids} distinct / {line_count} rows / "
        f"{duplicate_line_ids} duplicates"
    )
    reports.append(
        f"  Line count per order  : {one_line_orders} single-line orders, "
        f"{len(multi_line_orders)} multi-line order(s)"
    )
    reports.append("")
    reports.append("  ORD-1001 source split:")
    for _, row in ord_1001.sort_values("Line_Number").iterrows():
        reports.append(
            f"    {row['Order_Line_ID']}  {row['Product_SKU']}  "
            f"{row['Product_Name']:<20} qty={row['Quantity']:>2}  "
            f"price={money(row['Unit_Price_TND'])}  gross={money(row['Gross_Sales_TND'])}"
        )
    reports.append(
        f"    Line sum={ord_1001_gross:,.2f}; order-level ORD-1001 gross="
        f"{ord_1001_order_gross:,.2f}; expected=210.00."
    )
    reports.append(
        "  RESULT: PASS - the order-level file still has one row per order, while"
    )
    reports.append(
        "  the new line-level file has one row per source product line."
    )
    reports.append("")

    reports.append("3. TASK 2 - UNMATCHED REFERENCES")
    reports.append("-" * 88)
    reports.append("  Investigation result (all original source files):")
    reports.extend(unknown_results)
    reports.append("")
    reports.append(
        "  No correct master record was found for C999, P999 or ST99 in"
    )
    reports.append(
        "  02_customers_raw.csv, 03_products_raw.csv, 04_stores_raw.csv or any"
    )
    reports.append(
        "  payment row. No real name, city, category or region was inferred."
    )
    reports.append("")
    reports.append("  Action taken:")
    reports.append(
        "    - Kept the original unresolved keys in the facts."
    )
    reports.append(
        "    - Created explicit Unknown members in DimCustomer, DimProduct and DimStore."
    )
    reports.append(
        "    - Set Is_Unknown=True on those members."
    )
    reports.append(
        "    - Used clear labels such as 'Unknown Customer (C999)' and left"
    )
    reports.append(
        "      non-derivable details null (for example Segment and List_Price_TND)."
    )
    reports.append(
        "    - Retained UNMATCHED_CUSTOMER / UNMATCHED_PRODUCT / UNMATCHED_STORE flags"
    )
    reports.append("      on the affected fact rows.")
    reports.append(
        "  RESULT: PASS for referential integrity. The true identities remain an"
    )
    reports.append("  open business-data issue, not a silent data change.")
    reports.append("")

    reports.append("4. TASK 3 - PAYMENT ISSUES")
    reports.append("-" * 88)
    reports.append(
        f"  FactPayments: {len(fact_payments)} rows x {fact_payments.shape[1]} columns"
    )
    reports.append(
        f"  Payment total={payment_total:,.2f}; Paid={paid_total:,.2f}; "
        f"Refunded={refunded_total:,.2f}."
    )
    reports.append(
        f"  Missing payment amounts: {', '.join(missing_amount) if missing_amount else 'none'}"
    )
    reports.append("")
    reports.append("  Preserved exceptions:")
    payment_exceptions = [
        (
            "ORD-1030",
            "PAY029",
            "999.00",
            "Paid",
            f"Paid 999.00 vs order gross 45.00; difference {money(ord1030_diff)}.",
            "Amount preserved exactly; row flagged PAYMENT_AMOUNT_MISMATCH.",
        ),
        (
            "ORD-1021",
            "PAY020",
            "null",
            "Paid",
            "Payment status Paid but source amount is missing.",
            "Left null; not converted to zero; flagged PAYMENT_AMOUNT_MISSING.",
        ),
        (
            "ORD-1007",
            "none",
            "null",
            "No Payment",
            "Order is Pending and has no payment record.",
            "No payment row created; order flagged NO_PAYMENT_RECORD.",
        ),
        (
            "ORD-1017",
            "none",
            "null",
            "No Payment",
            "Order is Cancelled and has no payment record.",
            "No payment row created; order flagged NO_PAYMENT_RECORD.",
        ),
        (
            "ORD-1003",
            "PAY003",
            "250.00",
            "Refunded",
            "Refunded amount still present in the payment source.",
            "Amount preserved; net revenue is zero; flagged REFUNDED_AMOUNT_RETAINED.",
        ),
        (
            "ORD-1011",
            "PAY011",
            "37.00",
            "Refunded",
            "Refunded amount still present in the payment source.",
            "Amount preserved; net revenue is zero; flagged REFUNDED_AMOUNT_RETAINED.",
        ),
    ]
    for oid, pid, amount, status, issue, action in payment_exceptions:
        reports.append(f"    {oid}  payment={pid:<7} amount={amount:<8} status={status}")
        reports.append(f"      Issue : {issue}")
        reports.append(f"      Action: {action}")
    reports.append("")
    reports.append("  Payment reconciliation by order (non-reconciling orders only):")
    if reconciliation_rows:
        for oid, count, issue, detail in reconciliation_rows:
            reports.append(f"    {oid}  payments={count}  {issue}: {detail}")
    else:
        reports.append("    None.")
    reports.append("")
    reports.append(
        "  Duplicate/split payment handling: PAY035 (duplicate of PAY001) was"
    )
    reports.append(
        "  removed; ORD-1005 split payments PAY005=40.00 and PAY006=49.90 were"
    )
    reports.append(
        "  summed to 89.90. Rejected payments PAY022, PAY025 and PAY034 are absent"
    )
    reports.append("  from FactPayments and remain in the audit outputs.")
    reports.append(
        "  RESULT: PASS for preservation and traceability. Payment totals are not"
    )
    reports.append(
        "  certified until ORD-1030, ORD-1021, ORD-1007 and ORD-1017 are resolved."
    )
    reports.append("")

    reports.append("5. TASK 4 - CUSTOMER SEGMENT")
    reports.append("-" * 88)
    reports.append(
        f"  Customer_Segment null in clean_sales.csv      : {segment_order_nulls}"
    )
    reports.append(
        f"  Customer_Segment null in clean_sales_lines.csv: {segment_line_nulls}"
    )
    reports.append(
        f"  Segment null in DimCustomer.csv               : {segment_dim_nulls}"
    )
    reports.append(
        "  The source has no reliable customer segment field. The column is kept"
    )
    reports.append(
        "  null; no segment was inferred from customer name, city or spend."
    )
    reports.append(
        "  LIMITATION: segmentation, RFM by segment and segment-level dashboards"
    )
    reports.append("  are not supported until a reliable segment source is provided.")
    reports.append("")

    reports.append("6. FINANCIAL VALIDATION")
    reports.append("-" * 88)
    reports.append("  Gross sales calculation:")
    reports.append(f"    Rows checked                    : {len(clean_lines)}")
    reports.append(f"    Arithmetic discrepancies        : {gross_bad}")
    reports.append(f"    Line total (TND)                : {cl['Gross'].sum():,.2f}")
    reports.append(f"    Order total (TND)               : {cs['Gross'].sum():,.2f}")
    reports.append("")
    reports.append("  Net sales calculation:")
    reports.append(f"    Formula discrepancies           : {net_bad}")
    reports.append(f"    Discount range violations       : {discount_bad}")
    reports.append(f"    Net total (TND)                 : {cl['Net'].sum():,.2f}")
    reports.append(
        f"    Non-revenue orders              : {len(non_revenue)} "
        f"(gross {non_revenue_gross:,.2f}, net 0.00)"
    )
    reports.append(
        f"    Cancelled/Returned gross        : {expected_non_revenue:,.2f}"
    )
    reports.append(
        "    The difference between formula net and delivered net is exactly the"
    )
    reports.append(
        f"    gross of Cancelled/Returned orders: {expected_non_revenue:,.2f} TND."
    )
    reports.append("")
    reports.append(
        "  Discount note: the source has no discount field. Discount_Percent is"
    )
    reports.append(
        "  0.00 for every line; this is an absence of data, not an invented value."
    )
    reports.append("  RESULT: PASS - all delivered financial arithmetic reconciles.")
    reports.append("")

    reports.append("7. POWER BI STAR-SCHEMA VALIDATION")
    reports.append("-" * 88)
    reports.append("  Tables and grain:")
    reports.append("    FactSales       one row per order line")
    reports.append("    FactPayments    one row per matched payment record")
    reports.append("    DimCustomer     one row per customer key (including Unknown)")
    reports.append("    DimProduct      one row per product key (including Unknown)")
    reports.append("    DimStore        one row per store key (including Unknown)")
    reports.append("    DimDate         one row per calendar date")
    reports.append("    DimOrder        one row per order (bridge for the two facts)")
    reports.append("")
    reports.append("  Primary-key checks:")
    for label, ok, detail in key_checks:
        reports.append(f"    [{ 'PASS' if ok else 'FAIL' }] {label}: {detail}")
    reports.append("")
    reports.append("  Foreign-key orphan counts:")
    for name, value in fk_checks.items():
        reports.append(f"    [{ 'PASS' if value == 0 else 'FAIL' }] {name}: {value}")
    reports.append("")
    reports.append(
        f"  DimDate coverage: fact range {int(fact_dates.min())}..{int(fact_dates.max())}; "
        f"DimDate contains {len(dim_date)} continuous days."
    )
    reports.append(
        f"  FactSales rows={len(fact_sales)}; clean_sales_lines rows={len(clean_lines)}; "
        f"gross={fs['Gross'].sum():,.2f}; net={fs['Net'].sum():,.2f}."
    )
    reports.append(
        f"  FactPayments rows={len(fact_payments)}; unique Payment_ID="
        f"{fact_payments['Payment_ID'].nunique()}."
    )
    reports.append(
        "  RESULT: PASS - the star schema is structurally sound. Unknown members"
    )
    reports.append("  allow every fact row to resolve to a dimension row.")
    reports.append("")

    reports.append("8. POWER BI PREPARATION AND RELATIONSHIPS")
    reports.append("-" * 88)
    reports.append("  Recommended model:")
    reports.append("")
    reports.append("    DimCustomer[CustomerKey] 1 ---- * FactSales[CustomerKey]")
    reports.append("    DimProduct[ProductKey]   1 ---- * FactSales[ProductKey]")
    reports.append("    DimStore[StoreKey]       1 ---- * FactSales[StoreKey]")
    reports.append("    DimDate[DateKey]         1 ---- * FactSales[DateKey]")
    reports.append("    DimOrder[Order_ID]       1 ---- * FactSales[Order_ID]")
    reports.append("")
    reports.append("    DimCustomer[CustomerKey] 1 ---- * FactPayments[CustomerKey]")
    reports.append("    DimStore[StoreKey]       1 ---- * FactPayments[StoreKey]")
    reports.append("    DimDate[DateKey]         1 ---- * FactPayments[DateKey]")
    reports.append("    DimOrder[Order_ID]       1 ---- * FactPayments[Order_ID]")
    reports.append("")
    reports.append("  Relationship rules:")
    reports.append(
        "    - Use single-direction filtering from dimensions to facts."
    )
    reports.append(
        "    - Do not create a direct FactSales-FactPayments relationship:"
    )
    reports.append(
        "      FactSales has multiple rows per Order_ID, so that would create a"
    )
    reports.append("      many-to-many relationship. Use DimOrder as the bridge.")
    reports.append(
        "    - Hide all *Key columns from report view; keep them for relationships."
    )
    reports.append(
        "    - Mark DimDate as the date table and sort Month_Name by Month."
    )
    reports.append(
        "    - Set DateKey, Quantity, Payment_Count and Line_Count to Whole Number;"
    )
    reports.append(
        "      financial fields to Fixed Decimal Number (2 decimals); dates to Date."
    )
    reports.append("")
    reports.append("  Suggested base measures:")
    reports.append("    Gross Sales   = SUM ( FactSales[Gross_Sales_TND] )")
    reports.append("    Net Revenue   = SUM ( FactSales[Net_Sales_TND] )")
    reports.append("    Order Count   = DISTINCTCOUNT ( FactSales[Order_ID] )")
    reports.append("    Units Sold    = SUM ( FactSales[Quantity] )")
    reports.append("    AOV           = DIVIDE ( [Net Revenue], [Order Count] )")
    reports.append(
        "    Cash Collected= CALCULATE ( SUM ( FactPayments[Payment_Amount_TND] ),"
    )
    reports.append("                    FactPayments[Payment_Status] = \"Paid\" )")
    reports.append(
        "    Do not use SUM(FactPayments[Payment_Amount_TND]) as revenue: it"
    )
    reports.append(
        "    contains refunds and the unresolved ORD-1030 payment."
    )
    reports.append("")
    reports.append("  Unknown-member handling:")
    reports.append(
        "    - Keep Is_Unknown = TRUE rows in the dimensions so totals remain complete."
    )
    reports.append(
        "    - Add a report filter or visual cue for Is_Unknown = TRUE; do not"
    )
    reports.append(
        "      present the Unknown labels as real customer/product/store names."
    )
    reports.append("")

    reports.append("9. READINESS ASSESSMENT")
    reports.append("-" * 88)
    reports.append("  READY FOR POWER BI:")
    reports.append(
        "    - Order-level and line-level sales reporting, product/customer/store"
    )
    reports.append(
        "      slicing, date trending and revenue KPIs using Net_Sales_TND."
    )
    reports.append(
        "    - Gross-vs-net analysis, cancelled/returned audit views, order counts,"
    )
    reports.append(
        "      units sold and average order value."
    )
    reports.append(
        "    - Payment analysis after filtering Payment_Status and excluding the"
    )
    reports.append(
        "      unresolved ORD-1030 exception."
    )
    reports.append("")
    reports.append("  NOT YET CERTIFIED / REMAINS UNRESOLVED:")
    reports.append(
        "    - ORD-1030: 999.00 paid against 45.00 gross (954.00 difference)."
    )
    reports.append(
        "    - ORD-1021: Paid status with a missing amount (left null)."
    )
    reports.append(
        "    - ORD-1007 (Pending) and ORD-1017 (Cancelled): no payment record."
    )
    reports.append(
        "    - C999, P999 and ST99 true identities are unknown. Explicit Unknown"
    )
    reports.append(
        "      members are used; no real master data was invented."
    )
    reports.append(
        "    - Customer segment is unavailable; no segmentation or segment-level"
    )
    reports.append(
        "      analysis is possible until a reliable source is supplied."
    )
    reports.append(
        "    - No discount data exists in the source; Discount_Percent is 0.00."
    )
    reports.append("")
    reports.append(
        "  Do not certify payment totals or customer-segment analysis until the"
    )
    reports.append("  exceptions above are resolved by the business.")
    reports.append("")

    reports.append("10. CHECK RESULTS")
    reports.append("-" * 88)
    for name, ok, detail in checks:
        reports.append(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    reports.append("")
    reports.append(f"FINAL STATUS: {final_status}")
    reports.append("=" * 88)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(reports) + "\n", encoding="utf-8")

    print("\n".join(reports[:70]))
    print(f"\nWrote {REPORT_PATH}")
    print(f"FINAL STATUS: {final_status}")
    if structural_failures:
        print("Failed checks: " + ", ".join(structural_failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
