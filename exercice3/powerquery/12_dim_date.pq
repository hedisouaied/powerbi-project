// Query name: dim_date
let
    Source = Csv.Document(File.Contents(DataFolder & "\dim_date.csv"), [Delimiter = ",", Columns = 11, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"date", type date}, {"date_key", Int64.Type}, {"year", Int64.Type}, {"quarter", type text}, {"month_number", Int64.Type}, {"month_name", type text}, {"month_year", type text}, {"week_number", Int64.Type}, {"day_name", type text}, {"is_weekend", type logical}, {"is_month_end", type logical}}, "en-US"),
    YearMonth = Table.AddColumn(Typed, "year_month", each [year] * 100 + [month_number], Int64.Type),
    Result = YearMonth
in
    Result