-- Vários grupos para os avisos do WhatsApp e opção "manter conectado" no login.
ALTER TABLE "NotificationSettings" ADD COLUMN "groupJids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "groupNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- O grupo já configurado passa a ser o primeiro da lista
UPDATE "NotificationSettings"
SET "groupJids" = ARRAY["groupJid"], "groupNames" = ARRAY[COALESCE("groupName", 'Grupo')]
WHERE "groupJid" IS NOT NULL;

ALTER TABLE "NotificationSettings" DROP COLUMN "groupJid", DROP COLUMN "groupName";

ALTER TABLE "Session" ADD COLUMN "remember" BOOLEAN NOT NULL DEFAULT false;
