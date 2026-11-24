// Query name: entity_relationships
let
    Source = Csv.Document(File.Contents(DataFolder & "\entity_relationships.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"relationship_id", type text}, {"source_entity_type", type text}, {"source_entity_id", type text}, {"relationship_type", type text}, {"target_entity_type", type text}, {"target_entity_id", type text}, {"relationship_strength", type number}, {"relationship_basis", type text}}, "en-US"),
    Result = Typed
in
    Result