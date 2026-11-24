// Query name: sales_orders
let
    Source = Csv.Document(File.Contents(DataFolder & "\sales_orders.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"order_id", type text}, {"customer_id", type text}, {"order_date", type date}, {"sales_owner_id", type text}, {"sales_channel", type text}, {"order_status", type text}, {"net_amount_tnd", Currency.Type}, {"tax_amount_tnd", Currency.Type}, {"gross_amount_tnd", Currency.Type}, {"promised_delivery_date", type date}}, "en-US"),
    Result = Typed
in
    Result