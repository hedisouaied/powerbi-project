// Query name: data_quality_issues
let
    Source = Csv.Document(File.Contents(DataFolder & "\data_quality_issues.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"issue_id", type text}, {"source_table", type text}, {"issue_type", type text}, {"severity", type text}, {"issue_status", type text}, {"issue_description", type text}, {"detected_date", type date}}, "en-US"),
    Result = Typed
in
    Result