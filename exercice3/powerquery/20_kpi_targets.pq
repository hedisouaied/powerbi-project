// Query name: kpi_targets
let
    Source = Csv.Document(File.Contents(DataFolder & "\kpi_targets.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"target_id", type text}, {"department_id", type text}, {"month_start", type date}, {"revenue_target_tnd", Currency.Type}, {"gross_margin_target_pct", type number}, {"customer_satisfaction_target", type number}, {"incident_rate_target_pct", type number}}, "en-US"),
    Result = Typed
in
    Result