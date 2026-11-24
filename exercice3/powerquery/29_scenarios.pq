// Query name: scenarios
let
    Source = Csv.Document(File.Contents(DataFolder & "\scenarios.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"scenario_id", type text}, {"scenario_name", type text}, {"scenario_description", type text}, {"revenue_change_pct", type number}, {"cost_change_pct", type number}, {"retention_change_pct", type number}, {"margin_change_pct", type number}}, "en-US"),
    Result = Typed
in
    Result