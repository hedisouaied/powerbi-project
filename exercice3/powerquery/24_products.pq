// Query name: products
let
    Source = Csv.Document(File.Contents(DataFolder & "\products.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"product_id", type text}, {"product_name", type text}, {"category", type text}, {"product_tier", type text}, {"list_price_tnd", Currency.Type}, {"unit_cost_tnd", Currency.Type}, {"product_status", type text}}, "en-US"),
    Result = Typed
in
    Result