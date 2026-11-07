-- Repair verification (Advanced Features plan v2 §09, F4): new case event kinds. Enum values must
-- be committed before a later migration's functions can use them, as in A3.
alter type public.case_event_type add value if not exists 'repair_evidence_added';
alter type public.case_event_type add value if not exists 'verification_result';
alter type public.case_event_type add value if not exists 'verification_decided';
