// Query name: tasks
let
    Source = Csv.Document(File.Contents(DataFolder & "\tasks.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"task_id", type text}, {"task_title", type text}, {"project_id", type text}, {"assignee_id", type text},
        {"created_date", type date}, {"due_date", type date},
        {"task_status", type text}, {"priority", type text}, {"source", type text}
    }, "en-US")
in
    ChangedType
