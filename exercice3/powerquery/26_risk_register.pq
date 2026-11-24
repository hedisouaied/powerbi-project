// Query name: risk_register
let
    Source = Csv.Document(File.Contents(DataFolder & "\risk_register.csv"), [Delimiter = ",", Columns = 10, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"risk_id", type text}, {"risk_category", type text}, {"severity", type text}, {"confidence_score", type number}, {"estimated_exposure_tnd", Currency.Type}, {"department_id", type text}, {"risk_owner_employee_id", type text}, {"mitigation_status", type text}, {"identified_date", type date}, {"risk_description", type text}}, "en-US"),
    Result = Typed
in
    Result