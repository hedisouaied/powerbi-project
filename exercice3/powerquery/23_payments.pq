// Query name: payments
let
    Source = Csv.Document(File.Contents(DataFolder & "\payments.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"payment_id", type text}, {"order_id", type text}, {"customer_id", type text}, {"payment_date", type date}, {"payment_method", type text}, {"amount_tnd", Currency.Type}, {"payment_status", type text}, {"settlement_date", type date}}, "en-US"),
    Result = Typed
in
    Result