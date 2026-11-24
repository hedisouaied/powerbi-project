// Query name: calendar_events
let
    Source = Csv.Document(File.Contents(DataFolder & "\calendar_events.csv"), [Delimiter = ",", Columns = 16, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {{"event_id", type text}, {"event_title", type text}, {"event_type", type text}, {"priority", type text}, {"start_datetime", type datetime}, {"end_datetime", type datetime}, {"owner_employee_id", type text}, {"department_id", type text}, {"related_project_id", type text}, {"related_task_id", type text}, {"location_or_meeting_link", type text}, {"event_status", type text}, {"recurrence_pattern", type text}, {"reminder_setting", type text}, {"event_description", type text}, {"data_origin", type text}}, "en-US"),
    EventDate = Table.AddColumn(Typed, "event_date", each Date.From([start_datetime]), type date),
    Result = EventDate
in
    Result