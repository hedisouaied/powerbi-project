// Query name: expenses
// Blank project_id (42 rows = department overhead) becomes null through fnCleanText.
let
    Source = Csv.Document(File.Contents(DataFolder & "\expenses.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"expense_id", type text}, {"expense_date", type date}, {"department_id", type text}, {"project_id", type text},
        {"expense_category", type text}, {"approval_status", type text}, {"amount_tnd", Currency.Type}, {"description", type text}
    }, "en-US")
in
    ChangedType
