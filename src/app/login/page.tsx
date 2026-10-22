import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/");
  const hasUsers = (await db.user.count()) > 0;

  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-dashed border-cork p-10 lg:flex">
        <p className="eyebrow">Ferramenta interna · uso restrito</p>
        <div>
          <p className="eyebrow mb-4 accent">Supervisão de atendimento</p>
          <h1 className="text-[51px] font-medium uppercase leading-[0.9]">
            Equipe, rotina
            <br />e decisões
            <br />em um só lugar.
          </h1>
          <hr className="divider my-8 max-w-md" />
          <p className="max-w-md text-lg leading-snug text-muted">
            Frequência, escalas, desempenho, reuniões, feedbacks e tarefas da equipe — com histórico preservado e auditoria.
          </p>
        </div>
        <p className="text-[11px] uppercase text-subtle">Acesso pela rede interna ou VPN</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <p className="eyebrow mb-3 lg:hidden">Supervisão de atendimento</p>
          <h2 className="heading mb-8">Entrar</h2>
          {hasUsers ? (
            <ActionForm action={loginAction} className="flex flex-col gap-6">
              <TextField name="username" label="Usuário" autoComplete="username" required />
              <TextField name="password" label="Senha" type="password" autoComplete="current-password" required />
              <FormMessage />
              <SubmitButton className="w-full">Entrar</SubmitButton>
            </ActionForm>
          ) : (
            <div className="panel text-sm text-muted">
              <p className="subheading mb-3 text-cream">Nenhum usuário cadastrado</p>
              <p>
                Por segurança, o sistema não cria contas com senha padrão. No servidor, execute o comando abaixo para criar o
                usuário supervisor:
              </p>
              <pre className="mt-4 overflow-x-auto rounded-md border border-cork p-3 text-xs text-cream">npm run user:create</pre>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
