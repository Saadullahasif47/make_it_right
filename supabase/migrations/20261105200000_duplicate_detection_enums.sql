-- MakeItRight add-on A3: new enum values for duplicate linking (Advanced Features plan v2 F2).
-- Kept in their own migration because PostgreSQL cannot use an enum value added in the same
-- transaction; 20261105200100_duplicate_detection.sql uses them.

-- A case whose only report was linked into another case. It stays, with its history, for audit.
alter type public.maintenance_case_status add value if not exists 'merged';

alter type public.case_event_type add value if not exists 'report_linked';
alter type public.case_event_type add value if not exists 'merged';

-- On the reporter's timeline: "linked with other reports of the same problem".
alter type public.ticket_event_type add value if not exists 'case_linked';
