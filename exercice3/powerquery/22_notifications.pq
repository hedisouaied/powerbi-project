// Query name: notifications
let
    Source = Csv.Document(File.Contents(DataFolder & "\notifications.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"notification_id", type text}, {"notification_date", type date}, {"notification_category", type text}, {"severity", type text}, {"notification_message", type text}, {"read_status", type text}, {"recipient_employee_id", type text}, {"source_module", type text}, {"action_type", type text}}, "en-US"),
    Result = Typed
in
    Result