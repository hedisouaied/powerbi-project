// Query name: activity_log
let
    Source = Csv.Document(File.Contents(DataFolder & "\activity_log.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"activity_id", type text}, {"activity_date", type date}, {"employee_id", type text}, {"action_type", type text}, {"module_name", type text}, {"result", type text}, {"event_details", type text}}, "en-US"),
    Result = Typed
in
    Result