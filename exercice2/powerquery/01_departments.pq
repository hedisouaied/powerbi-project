// Query name: departments
let
    Source = Csv.Document(File.Contents(DataFolder & "\departments.csv"), [Delimiter = ",", Columns = 4, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"department_id", type text}, {"department_name", type text}, {"division", type text}, {"base_city", type text}
    }, "en-US")
in
    ChangedType
