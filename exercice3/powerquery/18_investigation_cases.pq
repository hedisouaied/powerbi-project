// Query name: investigation_cases
let
    Source = Csv.Document(File.Contents(DataFolder & "\investigation_cases.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"case_id", type text}, {"case_title", type text}, {"case_type", type text}, {"severity", type text}, {"case_status", type text}, {"case_owner_employee_id", type text}, {"department_id", type text}, {"opened_date", type date}, {"case_summary", type text}, {"review_status", type text}}, "en-US"),
    Result = Typed
in
    Result