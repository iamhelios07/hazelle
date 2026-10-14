-- diagnostics: the sender's 문제 진단 (runtime/diagnostics), when they chose to send it with the report; NULL otherwise
-- and for a share report.
ALTER TABLE reports ADD COLUMN diagnostics TEXT;
