"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { changePassword, revokeOtherSessions } from "@/lib/auth/account";
import { SESSION_COOKIE } from "@/lib/auth/dal";

export async function changePasswordAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await changePassword(db, actor, formToObject(fd), token);
    return { message: "Senha alterada. As outras sessões foram encerradas." };
  });
}

export async function revokeSessionsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const n = await revokeOtherSessions(db, actor, token);
    return { message: `${n} sessão(ões) encerrada(s).`, revalidate: ["/configuracoes"] };
  });
}
