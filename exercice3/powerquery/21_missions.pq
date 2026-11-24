// Query name: missions
let
    Source = Csv.Document(File.Contents(DataFolder & "\missions.csv"), [Delimiter = ",", Columns = 11, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"mission_id", type text}, {"mission_title", type text}, {"mission_category", type text}, {"priority", type text}, {"mission_status", type text}, {"department_id", type text}, {"target_value_tnd", Currency.Type}, {"progress_pct", type number}, {"completion_threshold_pct", type number}, {"start_date", type date}, {"target_date", type date}}, "en-US"),
    Result = Typed
in
    Result