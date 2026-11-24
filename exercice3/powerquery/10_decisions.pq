// Query name: decisions
let
    Source = Csv.Document(File.Contents(DataFolder & "\decisions.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"decision_id", type text}, {"decision_date", type date}, {"decision_type", type text}, {"department_id", type text}, {"decision_owner_id", type text}, {"decision_status", type text}, {"expected_impact_tnd", Currency.Type}, {"expected_kpi_change_pct", type number}, {"actual_kpi_change_pct", type number}, {"decision_notes", type text}}, "en-US"),
    Result = Typed
in
    Result