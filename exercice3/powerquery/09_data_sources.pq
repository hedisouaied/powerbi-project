// Query name: data_sources
let
    Source = Csv.Document(File.Contents(DataFolder & "\data_sources.csv"), [Delimiter = ",", Columns = 7, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"source_id", type text}, {"source_name", type text}, {"source_type", type text}, {"connection_location", type text}, {"refresh_frequency_label", type text}, {"source_files", type text}, {"connection_status", type text}}, "en-US"),
    Result = Typed
in
    Result