import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, CalendarClock, Send } from "lucide-react";
import { getCurrentActor, rememberedUsername } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { LogoMark } from "@/components/layout/app-shell";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

/** Etiquetas de destaque: uma cor de acento por item. */
const FEATURES = [
  { label: "Frequência e escalas", icon: CalendarClock, color: "text-tangerine" },
  { label: "Desempenho semanal", icon: BarChart3, color: "text-lavender" },
  { label: "Avisos no WhatsApp", icon: Send, color: "text-mint" },
];

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/");
  const hasUsers = (await db.user.count()) > 0;
  const lastUser = await rememberedUsername();

  return (
    <main className="relative isolate flex min-h-dvh flex-col bg-canvas">
      {/* Textura de pontos, mais forte no centro */}
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />

      <header className="flex items-center gap-2.5 px-5 py-5 sm:px-8">
        <LogoMark />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Supervisão</span>
        <span className="text-[13px] text-subtle">· Atendimento</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-5 pb-16">
        <ul className="mb-6 hidden flex-wrap justify-center gap-2 sm:flex" aria-label="Recursos">
          {FEATURES.map((f) => (
            <li key={f.label} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-medium">
              <f.icon className={`size-4 ${f.color}`} strokeWidth={2} aria-hidden />
              {f.label}
            </li>
          ))}
        </ul>
        <h1 className="mb-2 text-center font-display text-[36px] leading-[1.1] font-medium tracking-[-0.02em] sm:text-[44px]">
          A rotina da equipe, <span className="text-primary">em ordem.</span>
        </h1>
        <p className="mb-8 text-center text-[15px] text-muted">Entre com o usuário e a senha fornecidos pela supervisão.</p>

        <div className="w-full max-w-[400px] rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-ring)] sm:p-7">
          {hasUsers ? (
            <ActionForm action={loginAction} className="flex flex-col gap-4">
              <TextField name="username" label="Usuário" autoComplete="username" required defaultValue={lastUser} />
              <TextField name="password" label="Senha" type="password" autoComplete="current-password" required />
              <div className="flex flex-col gap-2">
                <CheckboxField name="rememberUser" label="Lembrar meu usuário neste computador" defaultChecked />
                <CheckboxField name="remember" label="Manter conectado por 30 dias" />
              </div>
              <FormMessage />
              <SubmitButton className="mt-1 min-h-10 w-full">Entrar</SubmitButton>
            </ActionForm>
          ) : (
            <div className="text-sm text-muted">
              <p className="subheading mb-2">Nenhum usuário cadastrado</p>
              <p>Por segurança, o sistema não cria contas com senha padrão. No servidor, crie o usuário supervisor:</p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-sidebar p-3 font-mono text-xs text-white">npm run user:create</pre>
            </div>
          )}
        </div>
        <p className="mt-6 text-[12px] text-subtle">Acesso pela rede da empresa ou VPN</p>
      </div>
    </main>
  );
}
