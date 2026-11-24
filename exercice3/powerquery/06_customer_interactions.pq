// Query name: customer_interactions
let
    Source = Csv.Document(File.Contents(DataFolder & "\customer_interactions.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"interaction_id", type text}, {"customer_id", type text}, {"interaction_date", type date}, {"channel", type text}, {"interaction_type", type text}, {"priority", type text}, {"interaction_status", type text}, {"resolution_hours", Int64.Type}, {"owner_employee_id", type text}}, "en-US"),
    Result = Typed
in
    Result