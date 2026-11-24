// Query name: projects
let
    Source = Csv.Document(File.Contents(DataFolder & "\projects.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"project_id", type text}, {"project_name", type text}, {"strategic_theme", type text}, {"department_id", type text}, {"project_owner_id", type text}, {"start_date", type date}, {"planned_end_date", type date}, {"project_status", type text}, {"approved_budget_tnd", Currency.Type}, {"completion_percent", type number}}, "en-US"),
    Result = Typed
in
    Result