// Query name: investigation_evidence
let
    Source = Csv.Document(File.Contents(DataFolder & "\investigation_evidence.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"evidence_id", type text}, {"case_id", type text}, {"evidence_type", type text}, {"source_table", type text}, {"source_record_reference", type text}, {"relevance_level", type text}, {"evidence_date", type date}, {"evidence_summary", type text}, {"evidence_status", type text}}, "en-US"),
    Result = Typed
in
    Result