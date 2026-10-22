"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { createFeedback, deleteFeedback, updateFeedback } from "./service";

export async function createFeedbackAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const f = await createFeedback(db, actor, formToObject(fd));
    return { redirectTo: `/feedbacks/${f.id}?salvo=1`, revalidate: ["/feedbacks", `/colaboradores/${f.employeeId}`, "/"] };
  });
}

export async function updateFeedbackAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const f = await updateFeedback(db, actor, id, formToObject(fd));
    return { redirectTo: `/feedbacks/${id}?salvo=1`, revalidate: ["/feedbacks", `/colaboradores/${f.employeeId}`, "/"] };
  });
}

export async function deleteFeedbackAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteFeedback(db, actor, id);
    return { redirectTo: "/feedbacks", revalidate: ["/feedbacks", "/"] };
  });
}
