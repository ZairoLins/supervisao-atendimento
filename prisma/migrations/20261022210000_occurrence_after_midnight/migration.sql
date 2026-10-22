-- Permite registrar ocorrências na parte de um plantão posterior à meia-noite
-- (início relativo à data do turno entre 24:00 e 47:59), com duração máxima de 24h.
ALTER TABLE "AttendanceOccurrence" DROP CONSTRAINT "AttendanceOccurrence_range";
ALTER TABLE "AttendanceOccurrence"
  ADD CONSTRAINT "AttendanceOccurrence_range" CHECK (
    ("startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("startMinute" >= 0 AND "startMinute" < 2880 AND "endMinute" > "startMinute" AND "endMinute" - "startMinute" <= 1440)
  );