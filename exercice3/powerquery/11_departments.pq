// Query name: departments
let
    Source = Csv.Document(File.Contents(DataFolder & "\departments.csv"), [Delimiter = ",", Columns = 5, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"department_id", type text}, {"department_name", type text}, {"division", type text}, {"primary_location", type text}, {"mission", type text}}, "en-US"),
    Result = Typed
in
    Result