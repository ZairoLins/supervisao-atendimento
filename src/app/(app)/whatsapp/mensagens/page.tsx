import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { readParams } from "@/lib/validation";
import { listTemplates } from "@/modules/whatsapp/service";
import { TEMPLATE_KEYS, type TemplateKey } from "@/modules/whatsapp/templates";
import { Badge, PageHeader, Panel, cx } from "@/components/ui/primitives";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Modelos de mensagem" };

export default async function MessageTemplatesPage(props: PageProps<"/whatsapp/mensagens">) {
  const actor = await requirePermission("messages:send");
  const params = readParams(await props.searchParams);
  const templates = await listTemplates(db, actor);
  const key: TemplateKey = (TEMPLATE_KEYS as readonly string[]).includes(params.modelo ?? "") ? (params.modelo as TemplateKey) : "MEETING_REMINDER";
  const current = templates.find((t) => t.key === key)!;
  const tz = env().APP_TIMEZONE;

  return (
    <>
      <PageHeader
        eyebrow="WhatsApp"
        title="Modelos de mensagem"
        description="Edite o texto de cada mensagem enviada pelo sistema. As partes entre {{chaves}} são preenchidas na hora do envio com os dados da reunião ou do relatório."
        actions={
          <Link href="/whatsapp" className="btn btn-secondary">
            <ArrowLeft className="size-3.5" aria-hidden /> Voltar para WhatsApp
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <nav aria-label="Modelos" className="flex flex-col gap-1.5">
          {templates.map((t) => (
            <Link
              key={t.key}
              href={`/whatsapp/mensagens?modelo=${t.key}`}
              aria-current={t.key === key ? "page" : undefined}
              className={cx("rounded-xl border px-4 py-3 transition-colors", t.key === key ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-line-strong")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                {t.customized ? <Badge tone="info" icon={false}>Editado</Badge> : null}
              </span>
              <span className="mt-0.5 block text-xs text-subtle">Para: {t.target}</span>
            </Link>
          ))}
        </nav>
        <Panel
          title={current.label}
          description={
            <>
              {current.description} Destino: <strong>{current.target}</strong>.
              {current.updatedAt ? ` Editado em ${formatDateTime(current.updatedAt, tz)}.` : " Usando o texto padrão do sistema."}
            </>
          }
        >
          <TemplateEditor templateKey={current.key} body={current.body} customized={current.customized} />
        </Panel>
      </div>
    </>
  );
}
