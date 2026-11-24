// Query name: approval_requests
let
    Source = Csv.Document(File.Contents(DataFolder & "\approval_requests.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"approval_id", type text}, {"request_type", type text}, {"priority", type text}, {"requested_amount_tnd", Currency.Type}, {"requester_employee_id", type text}, {"approver_employee_id", type text}, {"approval_status", type text}, {"request_date", type date}, {"request_description", type text}}, "en-US"),
    Result = Typed
in
    Result