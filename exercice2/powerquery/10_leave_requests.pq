// Query name: leave_requests
// working_days equals calendar days (weekends included) in all 60 rows: kept as-is, documented.
let
    Source = Csv.Document(File.Contents(DataFolder & "\leave_requests.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"leave_id", type text}, {"employee_id", type text}, {"leave_type", type text},
        {"start_date", type date}, {"end_date", type date}, {"working_days", Int64.Type},
        {"request_status", type text}, {"comment", type text}
    }, "en-US")
in
    ChangedType
