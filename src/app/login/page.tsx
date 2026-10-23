import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

const MODULES = ["Frequência e escalas", "Desempenho semanal", "Reuniões e pautas", "Feedbacks", "Relatórios", "WhatsApp"];

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/");
  const hasUsers = (await db.user.count()) > 0;

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-canvas lg:grid-cols-[1.15fr_1fr]">
      <section className="relative isolate hidden flex-col justify-between overflow-hidden border-r border-line px-14 py-12 lg:flex">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[28px] leading-none">Supervisão</span>
          <span aria-hidden className="size-1.5 -translate-y-0.5 rounded-full bg-primary" />
        </div>
        <div className="max-w-xl">
          <p className="eyebrow mb-6">Atendimento · uso interno</p>
          <h1 className="font-serif text-[64px] leading-[0.98] tracking-[-0.02em] xl:text-[76px]">
            A rotina da equipe, <em className="text-primary">em ordem.</em>
          </h1>
          <ul className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-muted">
            {MODULES.map((m, i) => (
              <li key={m} className="flex items-center gap-5">
                {m}
                {i < MODULES.length - 1 ? <span aria-hidden className="text-line-strong">/</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-mono text-[11px] tracking-[0.06em] text-subtle uppercase">Acesso pela rede da empresa ou VPN</p>
        {/* Grade de linhas finas como textura */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:linear-gradient(to_right,var(--color-line)_1px,transparent_1px)] [background-size:96px_100%] [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]"
        />
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-12 flex items-baseline gap-2 lg:hidden">
            <span className="font-serif text-[30px] leading-none">Supervisão</span>
            <span aria-hidden className="size-1.5 -translate-y-0.5 rounded-full bg-primary" />
          </div>
          <h2 className="font-serif text-[40px] leading-none">Entrar</h2>
          <p className="mt-3 mb-9 text-[14.5px] text-muted">Use o usuário e a senha fornecidos pela supervisão.</p>
          {hasUsers ? (
            <ActionForm action={loginAction} className="flex flex-col gap-5">
              <TextField name="username" label="Usuário" autoComplete="username" required />
              <TextField name="password" label="Senha" type="password" autoComplete="current-password" required />
              <FormMessage />
              <SubmitButton className="mt-1 w-full min-h-11">Entrar</SubmitButton>
            </ActionForm>
          ) : (
            <div className="panel text-sm text-muted">
              <p className="subheading mb-2">Nenhum usuário cadastrado</p>
              <p>Por segurança, o sistema não cria contas com senha padrão. No servidor, crie o usuário supervisor:</p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-sidebar p-3 font-mono text-xs text-white">npm run user:create</pre>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
