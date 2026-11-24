// Query name: alerts
let
    Source = Csv.Document(File.Contents(DataFolder & "\alerts.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"alert_id", type text}, {"alert_date", type date}, {"alert_type", type text}, {"severity", type text}, {"alert_status", type text}, {"affected_area", type text}, {"alert_description", type text}, {"confidence_score", type number}}, "en-US"),
    Result = Typed
in
    Result