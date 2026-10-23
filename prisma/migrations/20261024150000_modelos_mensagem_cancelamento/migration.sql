-- Modelos editáveis das mensagens do WhatsApp e motivo de cancelamento das reuniões.
ALTER TABLE "Meeting" ADD COLUMN "cancelReason" TEXT;

CREATE TABLE "MessageTemplate" (
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("key")
);
