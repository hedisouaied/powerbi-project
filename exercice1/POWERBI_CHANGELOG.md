# Power BI Enhancement Changelog

## Date
2026-11-02

## Scope
Enhanced the existing `biproject` Power BI solution using the validated line-level clean data. The original `biproject.pbix` was **not overwritten**. The enhanced report is delivered as a PBIP project:

- `biproject.pbip`
- `biproject.Report/`
- `biproject.SemanticModel/`

## Semantic Model
- Added a `DataFolder` text parameter. Default:
  `C:\Users\HediSouaeid\Downloads\biproject\output`
- Imported seven tables from `output/`:
  - `FactSales` (33 lines)
  - `FactPayments` (31 payments)
  - `DimCustomer` (16 members)
  - `DimProduct` (14 members)
  - `DimStore` (7 members)
  - `DimDate` (69 dates)
  - `DimOrder` (32 orders)
- Added nine single-direction relationships:
  - `FactSales[Order_ID]` -> `DimOrder[Order_ID]`
  - `FactPayments[Order_ID]` -> `DimOrder[Order_ID]`
  - `FactSales[DateKey]` -> `DimDate[DateKey]`
  - `FactPayments[DateKey]` -> `DimDate[DateKey]`
  - `FactSales[CustomerKey]` -> `DimCustomer[CustomerKey]`
  - `FactPayments[CustomerKey]` -> `DimCustomer[CustomerKey]`
  - `FactSales[ProductKey]` -> `DimProduct[ProductKey]`
  - `FactSales[StoreKey]` -> `DimStore[StoreKey]`
  - `FactPayments[StoreKey]` -> `DimStore[StoreKey]`
- `DimDate` is marked as the date table.
- `DimOrder` is used as the shared order bridge. There is no direct `FactSales`–`FactPayments` relationship.
- Added 30 DAX measures on `FactSales`, organized into display folders:
  - Financial: Gross Sales, Net Revenue, Units Sold, Order Count, Line Count, AOV
  - Pricing: Average Unit Price, Average List Price, Discount %
  - Status: Cancelled Gross, Returned Gross
  - Payments: Cash Collected, Refunded Amount, Payment Amount Entered, Payment Records, Payment Variance, Missing Payment Amount Rows, Payment Exception Rows
  - Data Quality: No Payment Orders, Unknown Customer/Product/Store Lines, Unknown Member Lines, Data Quality Flagged Lines, Missing Segment Customers, Segment Coverage %, Revenue Eligible %, Unknown Customers/Products/Stores

## Report Pages
1. **Sales Overview**
   - KPI cards: Net Revenue, Gross Sales, Orders, Units Sold
   - Slicers: Date Range, Store, Category
   - Net Revenue by Month
   - Net Revenue by Order Status
   - Net Revenue by Store
   - Product snapshot table
2. **Product Performance**
   - Category slicer
   - Net Revenue by Product
   - Net Revenue by Category
   - Product metrics table
3. **Order Analysis**
   - KPI cards: Orders, Lines, AOV, Cancelled Gross
   - Gross vs Net by Order Status
   - Orders by Status
   - Order line detail table
4. **Price Analysis**
   - Average Unit Price by Product
   - Units vs Average Price scatter
   - Selling Price vs List Price
   - Price metrics table
5. **Date Trends**
   - Date range slicer
   - Net Revenue trend
   - Orders and Units trend
   - Monthly detail table
6. **Data Quality**
   - KPI cards: Flagged Lines, Unknown Member Lines, Missing Payment Amount, No Payment Orders, Segment Coverage
   - Payment exceptions table
   - Order flags table
   - Customer, product, and store quality tables

The original blank `Page 1` was renamed to `Sales Overview`. All pages are 1920 x 1080.

## Data Quality Exceptions Preserved
The report intentionally shows, rather than hides or silently corrects:

- ORD-1030: payment `PAY029` is 999.00 while gross sales are 45.00; difference 954.00.
- ORD-1021: payment `PAY020` has a null amount while status is Paid.
- ORD-1007 and ORD-1017: no payment records.
- ORD-1003: refunded payment 250.00 retained.
- ORD-1011: refunded payment 37.00 retained.
- Customer segment is null for all 16 customers; segment coverage is 0.00%.
- Unknown members are explicit and marked `Is_Unknown = True`:
  - Customer `C999`
  - Product `P999`
  - Store `ST99`

## Validation Performed
- `validate_v2.py`: PASS WITH DOCUMENTED EXCEPTIONS; exit code 0.
- Output report: `output/final_validation_report_v2.txt`.
- TMDL semantic model converted successfully to BIM with pbi-tools:
  - 7 tables
  - 9 relationships
  - 30 measures
  - model column names match CSV headers
- PBIR page, pages metadata, and visual JSON validated against Microsoft PBIR JSON schemas.
- All visual field references resolve to existing model tables, columns, or measures.
- All visual bounds are inside the 1920 x 1080 page canvas.
- PBIR contains 40 visuals across 6 pages.

## How to Open
1. Close any Power BI Desktop window that already has `biproject.pbip` open **without saving**, so it cannot overwrite the generated files.
2. Open `biproject.pbip` in Power BI Desktop.
3. Confirm the `DataFolder` parameter points to `C:\Users\HediSouaeid\Downloads\biproject\output`.
4. Refresh the semantic model.

## Known Limitations
- `Customer_Segment` remains null for all customers.
- `Discount_Percent` is 0.00 because the source has no discount data.
- Payment totals are not certified until the documented payment exceptions are resolved with the business.
- The PBIP semantic model has not been refreshed inside Power BI Desktop in this session. On first open, confirm the `DataFolder` parameter points to `C:\Users\HediSouaeid\Downloads\biproject\output` and refresh.
