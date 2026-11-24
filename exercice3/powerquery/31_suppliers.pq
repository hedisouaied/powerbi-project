// Query name: suppliers
let
    Source = Csv.Document(File.Contents(DataFolder & "\suppliers.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"supplier_id", type text}, {"supplier_name", type text}, {"supplier_category", type text}, {"country", type text}, {"risk_level", type text}, {"quality_rating", type number}, {"supplier_status", type text}}, "en-US"),
    Result = Typed
in
    Result