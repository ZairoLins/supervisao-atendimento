import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, CalendarClock, Headset, ShieldCheck } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

const HIGHLIGHTS = [
  { icon: CalendarClock, text: "Frequência, escalas e plantões 12x36" },
  { icon: BarChart3, text: "Métricas diárias e evolução da equipe" },
  { icon: ShieldCheck, text: "Histórico preservado e auditoria" },
];

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/");
  const hasUsers = (await db.user.count()) > 0;

  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[420px] rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[360px] rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary">
            <Headset className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">Supervisão de Atendimento</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">A rotina da equipe, organizada em um só lugar.</h1>
          <ul className="mt-8 flex flex-col gap-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.text} className="flex items-center gap-3 text-white/80">
                <span className="grid size-9 place-items-center rounded-lg bg-white/10">
                  <h.icon className="size-[18px]" aria-hidden />
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">Ferramenta interna · acesso pela rede da empresa ou VPN</p>
      </section>

      <section className="flex items-center justify-center bg-surface px-4 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-white">
              <Headset className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold">Supervisão</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Entrar</h2>
          <p className="mb-8 mt-1 text-sm text-muted">Use o usuário e a senha fornecidos pela supervisão.</p>
          {hasUsers ? (
            <ActionForm action={loginAction} className="flex flex-col gap-5">
              <TextField name="username" label="Usuário" autoComplete="username" required />
              <TextField name="password" label="Senha" type="password" autoComplete="current-password" required />
              <FormMessage />
              <SubmitButton className="w-full">Entrar</SubmitButton>
            </ActionForm>
          ) : (
            <div className="panel text-sm text-muted">
              <p className="subheading mb-2">Nenhum usuário cadastrado</p>
              <p>Por segurança, o sistema não cria contas com senha padrão. No servidor, crie o usuário supervisor:</p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-sidebar p-3 text-xs text-white">npm run user:create</pre>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
