// Query name: fnCleanText   (a function, not loaded to the model)
// Trims spaces, removes control characters and turns empty strings into null,
// for every column of a freshly imported CSV (all columns are still text at that point).
(source as table) as table =>
    Table.TransformColumns(
        source,
        List.Transform(
            Table.ColumnNames(source),
            (col) => {
                col,
                (v) => (let t = if v = null then null else Text.Trim(Text.Clean(v)) in if t = "" then null else t),
                type nullable text
            }
        )
    )
