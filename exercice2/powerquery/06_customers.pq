// Query name: customers
let
    Source = Csv.Document(File.Contents(DataFolder & "\customers.csv"), [Delimiter = ",", Columns = 4, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"customer_id", type text}, {"customer_name", type text}, {"customer_segment", type text}, {"city", type text}
    }, "en-US")
in
    ChangedType
