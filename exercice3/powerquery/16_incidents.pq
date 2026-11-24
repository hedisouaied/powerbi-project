// Query name: incidents
let
    Source = Csv.Document(File.Contents(DataFolder & "\incidents.csv"), [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"incident_id", type text}, {"incident_date", type date}, {"incident_type", type text}, {"severity", type text}, {"department_id", type text}, {"incident_owner_id", type text}, {"incident_status", type text}, {"estimated_impact_tnd", Currency.Type}, {"impact_domain", type text}}, "en-US"),
    Result = Typed
in
    Result