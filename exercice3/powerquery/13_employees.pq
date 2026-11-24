// Query name: employees
let
    Source = Csv.Document(File.Contents(DataFolder & "\employees.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"employee_id", type text}, {"employee_name", type text}, {"department_id", type text}, {"job_title", type text}, {"employment_status", type text}, {"location", type text}, {"monthly_salary_tnd", Currency.Type}, {"hire_date", type date}}, "en-US"),
    Result = Typed
in
    Result