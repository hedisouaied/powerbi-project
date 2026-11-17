// Query name: projects
let
    Source = Csv.Document(File.Contents(DataFolder & "\projects.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"project_id", type text}, {"project_name", type text}, {"project_manager_id", type text}, {"department_id", type text},
        {"start_date", type date}, {"deadline", type date},
        {"budget_tnd", Currency.Type}, {"actual_cost_tnd", Currency.Type},
        {"project_status", type text}, {"priority", type text}
    }, "en-US")
in
    ChangedType
