// Query name: strategic_goals
let
    Source = Csv.Document(File.Contents(DataFolder & "\strategic_goals.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"goal_id", type text}, {"goal_name", type text}, {"goal_metric", type text}, {"department_id", type text}, {"target_value", type number}, {"current_value", type number}, {"start_date", type date}, {"target_date", type date}, {"goal_status", type text}}, "en-US"),
    Result = Typed
in
    Result