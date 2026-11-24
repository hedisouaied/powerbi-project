// Query name: collaboration_comments
let
    Source = Csv.Document(File.Contents(DataFolder & "\collaboration_comments.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"comment_id", type text}, {"comment_date", type date}, {"author_employee_id", type text}, {"linked_item_type", type text}, {"linked_item_reference", type text}, {"comment_text", type text}, {"comment_type", type text}}, "en-US"),
    Result = Typed
in
    Result