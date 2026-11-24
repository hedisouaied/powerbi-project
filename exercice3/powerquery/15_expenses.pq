// Query name: expenses
let
    Source = Csv.Document(File.Contents(DataFolder & "\expenses.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"expense_id", type text}, {"expense_date", type date}, {"department_id", type text}, {"expense_category", type text}, {"amount_tnd", Currency.Type}, {"approval_status", type text}, {"submitted_by_employee_id", type text}, {"reference_code", type text}}, "en-US"),
    Result = Typed
in
    Result