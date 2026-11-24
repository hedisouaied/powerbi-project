// Query name: customers
let
    Source = Csv.Document(File.Contents(DataFolder & "\customers.csv"), [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"customer_id", type text}, {"customer_name", type text}, {"customer_segment", type text}, {"industry", type text}, {"region", type text}, {"acquisition_date", type date}, {"customer_status", type text}, {"annual_contract_value_tnd", Currency.Type}}, "en-US"),
    Result = Typed
in
    Result