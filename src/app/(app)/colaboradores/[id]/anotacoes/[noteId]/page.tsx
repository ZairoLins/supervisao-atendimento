import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { assertUuid, orNotFound } from "@/lib/page";
import { toDateKey } from "@/lib/dates";
import { NOTE_CATEGORY, options } from "@/lib/labels";
import { getNote } from "@/modules/feedbacks/service";
import { updateNoteAction } from "@/modules/employees/actions";
import { ActionForm, FormMessage, Hidden, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Editar anotação" };

export default async function EditNotePage(props: PageProps<"/colaboradores/[id]/anotacoes/[noteId]">) {
  const actor = await requirePermission("notes:write");
  const p = await props.params;
  const id = assertUuid(p.id);
  const note = await orNotFound(getNote(db, actor, assertUuid(p.noteId)));
  if (note.employeeId !== id) notFound();
  return (
    <>
      <PageHeader eyebrow={note.employee.fullName} title="Editar anotação" />
      <ActionForm action={updateNoteAction.bind(null, note.id)} className="panel flex max-w-2xl flex-col gap-5">
        <Hidden name="employeeId" value={note.employeeId} />
        <TextField name="date" label="Data" type="date" required defaultValue={toDateKey(note.date)} />
        <SelectField name="category" label="Categoria" options={options(NOTE_CATEGORY)} defaultValue={note.category} />
        <TextField name="title" label="Título" required defaultValue={note.title} maxLength={160} />
        <TextAreaField name="content" label="Conteúdo" required rows={6} defaultValue={note.content} maxLength={4000} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Salvar</SubmitButton>
          <Link className="btn btn-ghost" href={`/colaboradores/${id}?aba=anotacoes`}>Cancelar</Link>
          <FormMessage />
        </div>
      </ActionForm>
    </>
  );
}
