// Query name: employees
// Adds two columns: full_name (for slicers/visuals) and dq_shared_email (flags the 3 email
// addresses used by two employees each). Source values are not changed.
let
    Source = Csv.Document(File.Contents(DataFolder & "\employees.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"employee_id", type text}, {"first_name", type text}, {"last_name", type text}, {"email", type text},
        {"department_id", type text}, {"job_title", type text}, {"city", type text},
        {"hire_date", type date}, {"monthly_salary_tnd", Currency.Type}, {"employment_status", type text}
    }, "en-US"),
    AddedFullName = Table.AddColumn(ChangedType, "full_name", each [first_name] & " " & [last_name], type text),
    AllEmails = List.Buffer(AddedFullName[email]),
    AddedSharedEmailFlag = Table.AddColumn(AddedFullName, "dq_shared_email",
        each List.Count(List.Select(AllEmails, (e) => e = [email])) > 1, type logical)
in
    AddedSharedEmailFlag
