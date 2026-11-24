// Query name: sales_order_items
let
    Source = Csv.Document(File.Contents(DataFolder & "\sales_order_items.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"order_line_id", type text}, {"order_id", type text}, {"product_id", type text}, {"quantity", Int64.Type}, {"unit_price_tnd", Currency.Type}, {"discount_rate", type number}, {"net_line_amount_tnd", Currency.Type}, {"line_cost_tnd", Currency.Type}}, "en-US"),
    Result = Typed
in
    Result