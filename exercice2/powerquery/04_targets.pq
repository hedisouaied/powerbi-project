// Query name: targets
// achievement_pct is kept for reference only: never SUM or AVERAGE it in visuals.
// Achievement is recalculated in DAX from summed actual and target amounts (Phase 3).
let
    Source = Csv.Document(File.Contents(DataFolder & "\targets.csv"), [Delimiter = ",", Columns = 6, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    CleanedText = fnCleanText(PromotedHeaders),
    ChangedType = Table.TransformColumnTypes(CleanedText, {
        {"target_id", type text}, {"employee_id", type text}, {"target_month", type date},
        {"target_amount_tnd", Currency.Type}, {"actual_sales_tnd", Currency.Type}, {"achievement_pct", type number}
    }, "en-US")
in
    ChangedType
