// Query name: sales_transactions
// discount_pct holds a fraction (0.05 = 5 %), so it is typed as Percentage.
let
    Source = Csv.Document(File.Contents(DataFolder & "\sales_transactions.csv"), [Delimiter = ",", Columns = 13, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"transaction_id", type text}, {"transaction_date", type date},
        {"customer_id", type text}, {"product_id", type text}, {"seller_id", type text},
        {"quantity", Int64.Type}, {"unit_price_tnd", Currency.Type}, {"discount_pct", Percentage.Type},
        {"revenue_tnd", Currency.Type}, {"cost_tnd", Currency.Type}, {"profit_tnd", Currency.Type},
        {"payment_status", type text}, {"sales_region", type text}
    }, "en-US")
in
    ChangedType
