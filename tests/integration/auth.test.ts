import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authenticate, MAX_FAILURES_PER_USERNAME } from "@/lib/auth/login";
import { createSession, hashSessionToken, invalidateSession, validateSessionToken } from "@/lib/auth/sessions";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { changePassword } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { assertCan, can, permissionsFor } from "@/lib/permissions";
import { proxy } from "@/proxy";
import { createUser, disconnect, hasTestDb, resetDb, testDb } from "../support/db";

describe("senhas", () => {
  it("usa hash argon2id e verifica corretamente", async () => {
    const h = await hashPassword("SenhaForte123");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, "SenhaForte123")).toBe(true);
    expect(await verifyPassword(h, "outra")).toBe(false);
    expect(await verifyPassword("hash-invalido", "x")).toBe(false);
  });

  it("aplica política mínima", () => {
    expect(checkPasswordPolicy("curta1")).toMatch(/pelo menos/);
    expect(checkPasswordPolicy("somenteletrasaqui")).toMatch(/letras e números/);
    expect(checkPasswordPolicy("letras123numeros")).toBeNull();
  });
});

describe("proteção de rotas (proxy)", () => {
  it("redireciona para /login sem cookie de sessão", () => {
    const res = proxy(new NextRequest("http://localhost/colaboradores"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("deixa passar quando há cookie (validação real ocorre no servidor)", () => {
    const req = new NextRequest("http://localhost/colaboradores", { headers: { cookie: "sv_session=abc" } });
    expect(proxy(req).headers.get("location")).toBeNull();
  });
});

describe("permissões por perfil", () => {
  it("supervisor tem acesso total; auxiliar não acessa frequência nem feedbacks", () => {
    const sup = { permissions: permissionsFor("SUPERVISOR") };
    const asst = { permissions: permissionsFor("ASSISTANT") };
    expect(can(sup, "attendance:restricted")).toBe(true);
    expect(can(asst, "attendance:read")).toBe(false);
    expect(can(asst, "feedbacks:read")).toBe(false);
    expect(() => assertCan(asst, "employees:write")).toThrow(AppError);
  });
});

describe.skipIf(!hasTestDb)("autenticação e sessões (banco)", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("autentica com credenciais válidas e registra auditoria", async () => {
    await createUser("SUPERVISOR", "maria");
    const user = await authenticate(testDb(), { username: "Maria", password: "SenhaDeTeste123", ipHash: "ip1" });
    expect(user.username).toBe("maria");
    const logs = await testDb().auditLog.findMany({ where: { action: "LOGIN" } });
    expect(logs).toHaveLength(1);
  });

  it("usa mensagem genérica para usuário inexistente e senha errada", async () => {
    await createUser("SUPERVISOR", "maria");
    const a = await authenticate(testDb(), { username: "maria", password: "errada", ipHash: "ip1" }).catch((e) => e);
    const b = await authenticate(testDb(), { username: "ninguem", password: "errada", ipHash: "ip1" }).catch((e) => e);
    expect(a.message).toBe("Usuário ou senha inválidos.");
    expect(b.message).toBe(a.message);
  });

  it("bloqueia após tentativas excessivas, mesmo com a senha correta", async () => {
    await createUser("SUPERVISOR", "maria");
    for (let i = 0; i < MAX_FAILURES_PER_USERNAME; i++) {
      await authenticate(testDb(), { username: "maria", password: "errada", ipHash: `ip${i}` }).catch(() => null);
    }
    const err = await authenticate(testDb(), { username: "maria", password: "SenhaDeTeste123", ipHash: "outro" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("não autentica usuário inativo", async () => {
    const actor = await createUser("SUPERVISOR", "maria");
    await testDb().user.update({ where: { id: actor.id }, data: { active: false } });
    await expect(authenticate(testDb(), { username: "maria", password: "SenhaDeTeste123", ipHash: "x" })).rejects.toThrow(AppError);
  });

  it("guarda apenas o hash do token e valida/expira/invalida sessões", async () => {
    const actor = await createUser();
    const { token } = await createSession(testDb(), actor.id, 12);
    const stored = await testDb().session.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(hashSessionToken(token));
    expect(stored[0].id).not.toContain(token);

    const ok = await validateSessionToken(testDb(), token, 12);
    expect(ok?.user.id).toBe(actor.id);
    expect(await validateSessionToken(testDb(), "token-falso", 12)).toBeNull();

    const later = new Date(Date.now() + 13 * 3_600_000);
    expect(await validateSessionToken(testDb(), token, 12, later)).toBeNull();
    expect(await testDb().session.count()).toBe(0);

    const s2 = await createSession(testDb(), actor.id, 12);
    await invalidateSession(testDb(), s2.token);
    expect(await validateSessionToken(testDb(), s2.token, 12)).toBeNull();
  });

  it("renova a sessão quando passa da metade da validade", async () => {
    const actor = await createUser();
    const { token } = await createSession(testDb(), actor.id, 12);
    const r = await validateSessionToken(testDb(), token, 12, new Date(Date.now() + 7 * 3_600_000));
    expect(r?.renewedExpiresAt).not.toBeNull();
  });

  it("troca de senha exige a senha atual e encerra outras sessões", async () => {
    const actor = await createUser();
    const s1 = await createSession(testDb(), actor.id, 12);
    await createSession(testDb(), actor.id, 12);
    await expect(changePassword(testDb(), actor, { currentPassword: "errada", newPassword: "NovaSenha2026", confirmPassword: "NovaSenha2026" }, s1.token)).rejects.toThrow(/incorreta/);
    await changePassword(testDb(), actor, { currentPassword: "SenhaDeTeste123", newPassword: "NovaSenha2026", confirmPassword: "NovaSenha2026" }, s1.token);
    expect(await testDb().session.count()).toBe(1);
    const user = await testDb().user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(await verifyPassword(user.passwordHash, "NovaSenha2026")).toBe(true);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "PASSWORD_CHANGE" } });
    expect(JSON.stringify(audit)).not.toContain("NovaSenha2026");
  });
});
