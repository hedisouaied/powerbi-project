// Query name: inventory_snapshots
let
    Source = Csv.Document(File.Contents(DataFolder & "\inventory_snapshots.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"inventory_snapshot_id", type text}, {"product_id", type text}, {"warehouse", type text}, {"snapshot_date", type date}, {"quantity_on_hand", Int64.Type}, {"reorder_point", Int64.Type}, {"target_stock", Int64.Type}, {"supplier_id", type text}}, "en-US"),
    Result = Typed
in
    Result