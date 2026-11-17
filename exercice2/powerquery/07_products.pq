// Query name: products
let
    Source = Csv.Document(File.Contents(DataFolder & "\products.csv"), [Delimiter = ",", Columns = 4, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"product_id", type text}, {"product_name", type text}, {"category", type text}, {"list_price_tnd", Currency.Type}
    }, "en-US")
in
    ChangedType
