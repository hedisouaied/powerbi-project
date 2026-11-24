// Query name: fnCleanText (function, not loaded)
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