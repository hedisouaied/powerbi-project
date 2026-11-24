// Query name: tasks
let
    Source = Csv.Document(File.Contents(DataFolder & "\tasks.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"task_id", type text}, {"project_id", type text}, {"department_id", type text}, {"assignee_employee_id", type text}, {"task_title", type text}, {"task_status", type text}, {"priority", type text}, {"created_date", type date}, {"due_date", type date}, {"task_type", type text}}, "en-US"),
    Result = Typed
in
    Result