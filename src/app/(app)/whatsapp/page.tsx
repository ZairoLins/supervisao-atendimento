import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleX, FileText, LineChart, Send, Smartphone } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";
import { today } from "@/lib/page";
import { addMonths, formatDateTime, monthKey, startOfMonth, toDateKey } from "@/lib/dates";
import { pageParam, readParams } from "@/lib/validation";
import { evolutionConfigFromEnv, evolutionSender, fetchQrCode } from "@/modules/whatsapp/client";
import { getNotificationSettings, listMessages, maskPhone, MESSAGE_KINDS, type MessageKind } from "@/modules/whatsapp/service";
import { payrollLabel, payrollPeriod, previousPayrollPeriod } from "@/modules/reports/occurrences-report";
import {
  saveNotificationSettingsAction,
  sendMonthlyMetricsAction,
  sendOccurrencesAction,
  sendTestAction,
} from "@/modules/whatsapp/actions";
import { ActionForm, CheckboxField, FormMessage, Hidden, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, EmptyState, Notice, PageHeader, Pagination, Panel } from "@/components/ui/primitives";
import { GroupPicker } from "./group-picker";

export const metadata: Metadata = { title: "WhatsApp" };

const STATE_LABEL = { open: "Conectado", connecting: "Conectando…", close: "Desconectado", unknown: "Estado desconhecido" } as const;

/** Estado da conexão e grupos, com tempo curto de espera para não travar a página. */
async function connection() {
  const cfg = evolutionConfigFromEnv();
  if (!cfg) return { configured: false as const };
  const sender = evolutionSender({ ...cfg, timeoutMs: 5000 });
  try {
    const state = await sender.connectionState();
    const groups = state === "open" ? await sender.fetchGroups().catch(() => []) : [];
    const qr = state === "open" ? null : await fetchQrCode({ ...cfg, timeoutMs: 8000 }).catch(() => null);
    return { configured: true as const, instance: cfg.instance, state, groups, qr, error: null };
  } catch (e) {
    return { configured: true as const, instance: cfg.instance, state: "unknown" as const, groups: [], qr: null, error: e instanceof Error ? e.message : "Falha ao consultar." };
  }
}

export default async function WhatsAppPage(props: PageProps<"/whatsapp">) {
  const actor = await requirePermission("messages:send");
  const params = readParams(await props.searchParams);
  const [settings, conn, history] = await Promise.all([getNotificationSettings(db), connection(), listMessages(db, actor, pageParam(params))]);
  const t = today();
  const lastPayroll = previousPayrollPeriod(t);
  const currentPayroll = payrollPeriod(t);
  const lastMonth = startOfMonth(addMonths(t, -1));
  const ready = conn.configured && conn.state === "open";
  const tz = env().APP_TIMEZONE;

  return (
    <>
      <PageHeader
        eyebrow="Envios"
        title="WhatsApp"
        description="Envie ao gestor as ocorrências da folha, as pautas e o relatório mensal, e avise o grupo do Suporte Interno sobre a reunião semanal. Pautas e avisos também podem ser enviados pela página de cada reunião."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Enviar ao gestor" description={settings.managerPhone ? `Destino: ${settings.managerName ?? "Gestor"} (${maskPhone(settings.managerPhone)})` : "Cadastre o número do gestor em Destinatários."}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ActionForm action={sendOccurrencesAction} className="flex flex-col gap-4 rounded-xl border border-line p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><FileText className="size-4" aria-hidden /></span>
                  <div>
                    <p className="font-medium">Ocorrências da folha</p>
                    <p className="text-xs text-subtle">PDF + resumo. A folha vai do dia 20 ao dia 19.</p>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="w-folha">Período</label>
                  <select id="w-folha" name="folha" className="input" defaultValue={toDateKey(lastPayroll.from)}>
                    <option value={toDateKey(lastPayroll.from)}>{payrollLabel(lastPayroll)} (fechada)</option>
                    <option value={toDateKey(currentPayroll.from)}>{payrollLabel(currentPayroll)} (em andamento)</option>
                  </select>
                </div>
                <SubmitButton className="self-start" confirm="Enviar as ocorrências ao gestor pelo WhatsApp?"><Send className="size-3.5" aria-hidden /> Enviar ocorrências</SubmitButton>
                <FormMessage />
              </ActionForm>
              <ActionForm action={sendMonthlyMetricsAction} className="flex flex-col gap-4 rounded-xl border border-line p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><LineChart className="size-4" aria-hidden /></span>
                  <div>
                    <p className="font-medium">Relatório mensal de métricas</p>
                    <p className="text-xs text-subtle">PDF com indicadores, gráfico e comparação.</p>
                  </div>
                </div>
                <TextField name="mes" label="Mês" type="month" required defaultValue={monthKey(lastMonth)} max={monthKey(t)} />
                <SubmitButton className="self-start" confirm="Enviar o relatório mensal ao gestor pelo WhatsApp?"><Send className="size-3.5" aria-hidden /> Enviar relatório</SubmitButton>
                <FormMessage />
              </ActionForm>
            </div>
            <p className="mt-4 text-xs text-subtle">
              Dica: confira antes em Relatórios (Ocorrências da folha / Relatório mensal de métricas), que geram os mesmos PDFs.
            </p>
          </Panel>

          <Panel title="Histórico de envios" description="Os anexos não ficam guardados; apenas o registro do envio.">
            {history.items.length === 0 ? (
              <EmptyState title="Nenhum envio ainda" description="Os envios aparecerão aqui com data, destino e resultado." />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Quando</th><th>Envio</th><th>Destino</th><th>Situação</th></tr></thead>
                    <tbody>
                      {history.items.map((m) => (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt, tz)}{m.automatic ? <span className="block text-subtle">automático</span> : null}</td>
                          <td>
                            <p className="font-medium">{MESSAGE_KINDS[m.kind as MessageKind] ?? m.kind}</p>
                            <p className="text-xs text-subtle">{m.summary}</p>
                          </td>
                          <td className="text-sm">{m.destination}</td>
                          <td>{m.status === "SENT" ? <Badge tone="ok">Enviado</Badge> : <><Badge tone="danger">Falhou</Badge>{m.error ? <p className="mt-1 max-w-64 text-xs text-danger">{m.error}</p> : null}</>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={history.page} pageCount={history.pageCount} total={history.total} base="/whatsapp" params={params} />
              </>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Conexão">
            {!conn.configured ? (
              <Notice tone="warn">
                O serviço de WhatsApp ainda não foi configurado no servidor. Defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE em /etc/supervisao/supervisao.env (veja docs/IMPLANTACAO.md).
              </Notice>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className={`grid size-10 place-items-center rounded-full ${ready ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
                    {ready ? <CircleCheck className="size-5" aria-hidden /> : <CircleX className="size-5" aria-hidden />}
                  </span>
                  <div>
                    <p className="font-medium">{STATE_LABEL[conn.state]}</p>
                    <p className="text-xs text-subtle">Instância “{conn.instance}”</p>
                  </div>
                </div>
                {conn.error ? <Notice tone="danger">{conn.error}</Notice> : null}
                {!ready && conn.qr ? (
                  <div className="flex flex-col items-start gap-3 rounded-xl border border-line p-4">
                    <p className="text-sm">
                      No celular do número que fará os envios: <strong>WhatsApp › Aparelhos conectados › Conectar aparelho</strong> e leia o código.
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora (data URL) */}
                    <img src={conn.qr} alt="QR Code para conectar o WhatsApp" width={224} height={224} className="rounded-lg border border-line bg-white p-2" />
                    <Link href="/whatsapp" className="btn btn-secondary btn-sm">Já li o código / gerar novo</Link>
                    <p className="text-xs text-subtle">O código expira em poucos segundos; se expirar, gere outro.</p>
                  </div>
                ) : null}
                {!ready && !conn.qr && !conn.error ? <p className="text-xs text-muted">Aguardando a conexão. Atualize a página para gerar o QR Code.</p> : null}
                <div className="flex flex-wrap gap-2">
                  {(["MANAGER", "GROUP"] as const).map((target) => (
                    <ActionForm key={target} action={sendTestAction} className="flex flex-col gap-2">
                      <Hidden name="target" value={target} />
                      <SubmitButton variant="secondary" className="btn-sm"><Smartphone className="size-3.5" aria-hidden /> Testar {target === "MANAGER" ? "gestor" : "grupo"}</SubmitButton>
                      <FormMessage />
                    </ActionForm>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Destinatários e aviso automático">
            <ActionForm action={saveNotificationSettingsAction} className="flex flex-col gap-5">
              <TextField name="managerName" label="Nome do gestor" defaultValue={settings.managerName} maxLength={120} />
              <TextField name="managerPhone" label="WhatsApp do gestor" defaultValue={settings.managerPhone} placeholder="(11) 99999-8888" inputMode="numeric" maxLength={30} hint="Com DDD. Números sem código do país recebem +55." />
              <GroupPicker groups={conn.configured ? conn.groups : []} defaultJid={settings.groupJid} defaultName={settings.groupName} />
              <div className="rounded-xl border border-line p-4">
                <CheckboxField name="reminderEnabled" label="Avisar o grupo automaticamente antes da reunião semanal" defaultChecked={settings.reminderEnabled} />
                <div className="mt-4 max-w-48">
                  <TextField name="reminderHoursBefore" label="Antecedência (horas)" type="number" min={0} max={72} required defaultValue={settings.reminderHoursBefore} />
                </div>
                <p className="mt-2 text-xs text-subtle">Vale para reuniões do tipo semanal ainda agendadas. Cada reunião recebe um aviso só; ao enviar manualmente, o automático não repete.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3"><SubmitButton>Salvar</SubmitButton><FormMessage /></div>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
