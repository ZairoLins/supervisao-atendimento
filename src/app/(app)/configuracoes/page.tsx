import type { Metadata } from "next";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/dal";
import { listSessions } from "@/lib/auth/account";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { can, type Actor } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { pageParam, readParams } from "@/lib/validation";
import { listOccurrenceTypes } from "@/modules/attendance/occurrences";
import { createOccurrenceTypeAction, toggleOccurrenceTypeAction } from "@/modules/attendance/actions";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Notice, PageHeader, Pagination, Panel, Tabs, buildHref } from "@/components/ui/primitives";
import { changePasswordAction, revokeSessionsAction } from "./actions";

export const metadata: Metadata = { title: "Configurações" };

const TIME_MODE_LABEL = { NONE: "Turno inteiro", ARRIVAL: "Hora de chegada", DEPARTURE: "Hora de saída", RANGE: "Início e fim" } as const;

export default async function SettingsPage(props: PageProps<"/configuracoes">) {
  const actor = await requireActor();
  const params = readParams(await props.searchParams);
  const tabs = [
    { key: "conta", label: "Conta e sessões", show: true },
    { key: "tipos", label: "Tipos de ocorrência", show: can(actor, "settings:manage") },
    { key: "auditoria", label: "Auditoria", show: can(actor, "audit:read") },
    { key: "backups", label: "Backups", show: can(actor, "settings:manage") },
  ].filter((t) => t.show);
  const tab = tabs.find((t) => t.key === params.aba)?.key ?? "conta";
  return (
    <>
      <PageHeader eyebrow="Sistema" title="Configurações" />
      <Tabs active={tab} items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/configuracoes?aba=${t.key}` }))} />
      {tab === "conta" ? <Account actor={actor} /> : null}
      {tab === "tipos" ? <Types actor={actor} /> : null}
      {tab === "auditoria" ? <Audit params={params} /> : null}
      {tab === "backups" ? <Backups /> : null}
    </>
  );
}

async function Account({ actor }: { actor: Actor }) {
  const sessions = await listSessions(db, actor);
  const tz = env().APP_TIMEZONE;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Alterar senha">
        <ActionForm action={changePasswordAction} resetOnSuccess className="flex max-w-md flex-col gap-5">
          <TextField name="currentPassword" label="Senha atual" type="password" required autoComplete="current-password" />
          <TextField name="newPassword" label="Nova senha" type="password" required autoComplete="new-password" hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres, com letras e números.`} />
          <TextField name="confirmPassword" label="Confirmar nova senha" type="password" required autoComplete="new-password" />
          <SubmitButton>Alterar senha</SubmitButton>
          <FormMessage />
        </ActionForm>
      </Panel>
      <Panel title="Sessões ativas" description={`Usuário: ${actor.username}`}>
        <ul className="mb-5 flex flex-col gap-3 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="border-b border-line pb-3 last:border-0">
              <p className="truncate text-muted">{s.userAgent ?? "Navegador desconhecido"}</p>
              <p className="text-xs text-subtle">Início {formatDateTime(s.createdAt, tz)} · último acesso {formatDateTime(s.lastSeenAt, tz)} · expira {formatDateTime(s.expiresAt, tz)}</p>
            </li>
          ))}
        </ul>
        <ActionForm action={revokeSessionsAction}>
          <SubmitButton variant="secondary" className="btn-sm">Encerrar outras sessões</SubmitButton>
          <FormMessage />
        </ActionForm>
      </Panel>
    </div>
  );
}

async function Types({ actor }: { actor: Actor }) {
  const types = await listOccurrenceTypes(db, actor, { includeInactive: true });
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
      <Panel title="Tipos cadastrados">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tipo</th><th>Regras</th><th>Situação</th><th className="sr-only">Ações</th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}{t.isSystem ? <span className="block text-xs text-subtle">Tipo do sistema</span> : null}</td>
                  <td className="flex flex-wrap gap-1">
                    {t.countsAsAbsence ? <Badge tone="neutral">Desconta horas</Badge> : <Badge tone="neutral">Não desconta</Badge>}
                    {t.timeMode !== "NONE" ? <Badge tone="info">{TIME_MODE_LABEL[t.timeMode]}</Badge> : null}
                    {t.isMedical ? <Badge tone="warn">Médico / restrito</Badge> : null}
                  </td>
                  <td>{t.active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}</td>
                  <td className="text-right">
                    {!t.isSystem ? (
                      <ActionForm action={toggleOccurrenceTypeAction.bind(null, t.id)}>
                        <SubmitButton variant="ghost" className="btn-sm">{t.active ? "Desativar" : "Ativar"}</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Nova ocorrência administrativa">
        <ActionForm action={createOccurrenceTypeAction} resetOnSuccess className="flex flex-col gap-5">
          <TextField name="name" label="Nome" required maxLength={80} />
          <CheckboxField name="countsAsAbsence" label="Desconta das horas previstas" defaultChecked />
          <SelectField name="timeMode" label="Como informar o horário" defaultValue="NONE" options={Object.entries(TIME_MODE_LABEL).map(([value, label]) => ({ value, label }))} />
          <CheckboxField name="isMedical" label="Tipo médico (conteúdo restrito, fora da pesquisa e relatórios)" />
          <SubmitButton>Criar tipo</SubmitButton>
          <FormMessage />
        </ActionForm>
      </Panel>
    </div>
  );
}

async function currentTime() {
  return new Date().getTime();
}

const AUDIT_PAGE = 30;

async function Audit({ params }: { params: Record<string, string | undefined> }) {
  const page = pageParam(params);
  const where = {
    ...(params.entidade ? { entityType: params.entidade } : {}),
    ...(params.acao ? { action: params.acao } : {}),
  };
  const [total, logs, entities, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE, take: AUDIT_PAGE }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const tz = env().APP_TIMEZONE;
  const base = "/configuracoes";
  const p = { ...params, aba: "auditoria" };
  return (
    <Panel title="Registro de auditoria" description="Alterações relevantes, logins, exportações e acessos a anexos. Senhas, tokens e conteúdo médico nunca são registrados.">
      <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
        <input type="hidden" name="aba" value="auditoria" />
        <div>
          <label className="label" htmlFor="a-ent">Entidade</label>
          <select id="a-ent" name="entidade" defaultValue={params.entidade ?? ""} className="input w-52"><option value="">Todas</option>{entities.map((e) => <option key={e.entityType} value={e.entityType}>{e.entityType}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="a-acao">Ação</label>
          <select id="a-acao" name="acao" defaultValue={params.acao ?? ""} className="input w-52"><option value="">Todas</option>{actions.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}</select>
        </div>
        <button type="submit" className="btn btn-secondary">Filtrar</button>
        {params.entidade || params.acao ? <Link href={buildHref(base, { aba: "auditoria" }, {})} className="btn btn-ghost">Limpar</Link> : null}
      </form>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Resumo</th><th>Motivo</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(l.createdAt, tz)}</td>
                <td className="text-muted">{l.user?.name ?? "—"}</td>
                <td className="text-xs">{l.action}<span className="block text-subtle">{l.entityType}</span></td>
                <td>{l.summary}</td>
                <td className="text-xs text-muted">{l.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination base={base} params={p} page={page} pageCount={Math.ceil(total / AUDIT_PAGE)} total={total} />
    </Panel>
  );
}

/** Lê o diretório de backups (somente nomes .dump, tamanho e data). */
async function readBackups(dir: string | undefined, now: number) {
  let files: Array<{ name: string; size: number; mtime: Date }> = [];
  let error = false;
  if (dir) {
    try {
      const names = (await readdir(dir)).filter((n) => /^[\w.-]+\.dump$/.test(n));
      files = await Promise.all(names.map(async (name) => {
        const s = await stat(path.join(dir, name));
        return { name, size: s.size, mtime: s.mtime };
      }));
      files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch {
      error = true;
    }
  }
  const latest = files[0];
  const stale = latest ? now - latest.mtime.getTime() > 36 * 3_600_000 : true;
  return { files, error, latest, stale };
}

async function Backups() {
  const dir = env().BACKUP_DIR;
  const { files, error, latest, stale } = await readBackups(dir, await currentTime());
  const tz = env().APP_TIMEZONE;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Situação dos backups">
        {!dir ? (
          <Notice tone="warn">BACKUP_DIR não configurado. Defina a variável para acompanhar os backups por aqui (somente leitura).</Notice>
        ) : error ? (
          <Notice tone="danger">Não foi possível ler o diretório de backups. Verifique permissões do usuário do serviço.</Notice>
        ) : (
          <>
            {stale ? <div className="mb-4"><Notice tone="warn">Nenhum backup nas últimas 36 horas. Verifique o timer do systemd.</Notice></div> : <div className="mb-4"><Notice tone="ok">Último backup em {formatDateTime(latest!.mtime, tz)}.</Notice></div>}
            <ul className="flex flex-col gap-2 text-sm">
              {files.slice(0, 10).map((f) => (
                <li key={f.name} className="flex justify-between gap-3 border-b border-line pb-2 last:border-0">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-subtle">{formatDateTime(f.mtime, tz)} · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      <Panel title="Procedimento">
        <ul className="flex flex-col gap-3 text-sm text-muted">
          <li>Backups automáticos diários com <span className="text-ink">pg_dump</span> (formato custom), via timer do systemd — ver <span className="text-ink">deploy/backup.sh</span>.</li>
          <li>Retenção configurável (padrão: 14 diários). Copie os dumps para outro servidor ou mídia.</li>
          <li>Teste de restauração: <span className="text-ink">deploy/restore-test.sh</span> restaura o último dump em um banco temporário e confere as tabelas.</li>
          <li>Anexos privados ficam em ATTACHMENTS_DIR e devem entrar na mesma rotina de cópia.</li>
          <li>Detalhes em docs/IMPLANTACAO.md.</li>
        </ul>
      </Panel>
    </div>
  );
}
