import type {
  AdjustmentKind,
  EmployeeStatus,
  FeedbackStatus,
  FeedbackType,
  MeetingStatus,
  MeetingType,
  NoteCategory,
  ReviewStatus,
  Role,
  ScheduleKind,
} from "@/generated/prisma/enums";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

type LabelMap<T extends string> = Record<T, { label: string; tone: Tone }>;

export const EMPLOYEE_STATUS: LabelMap<EmployeeStatus> = {
  ACTIVE: { label: "Ativo", tone: "ok" },
  ON_LEAVE: { label: "Afastado", tone: "warn" },
  INACTIVE: { label: "Inativo", tone: "neutral" },
};

export const ROLE: LabelMap<Role> = {
  SUPERVISOR: { label: "Supervisor", tone: "accent" },
  ASSISTANT: { label: "Auxiliar", tone: "neutral" },
};

export const SCHEDULE_KIND: LabelMap<ScheduleKind> = {
  WEEKLY: { label: "Semanal fixa", tone: "neutral" },
  ROTATION: { label: "Revezamento (ciclo)", tone: "info" },
};

export const ADJUSTMENT_KIND: LabelMap<AdjustmentKind> = {
  DAY_OFF: { label: "Folga", tone: "neutral" },
  CUSTOM_HOURS: { label: "Horário ajustado", tone: "info" },
};

export const REVIEW_STATUS: LabelMap<ReviewStatus> = {
  PENDING: { label: "A conferir", tone: "warn" },
  CONFIRMED: { label: "Conferido", tone: "ok" },
  DISREGARDED: { label: "Desconsiderado", tone: "neutral" },
};

export const MEETING_TYPE: LabelMap<MeetingType> = {
  WEEKLY: { label: "Semanal", tone: "neutral" },
  EXTRAORDINARY: { label: "Extraordinária", tone: "accent" },
};

export const MEETING_STATUS: LabelMap<MeetingStatus> = {
  SCHEDULED: { label: "Agendada", tone: "info" },
  DONE: { label: "Realizada", tone: "ok" },
  CANCELED: { label: "Cancelada", tone: "neutral" },
};

export const FEEDBACK_TYPE: LabelMap<FeedbackType> = {
  RECOGNITION: { label: "Reconhecimento", tone: "ok" },
  DEVELOPMENT: { label: "Desenvolvimento", tone: "info" },
  CORRECTIVE: { label: "Corretivo", tone: "warn" },
  ALIGNMENT: { label: "Alinhamento", tone: "neutral" },
  ONE_ON_ONE: { label: "Conversa individual", tone: "neutral" },
};

export const FEEDBACK_STATUS: LabelMap<FeedbackStatus> = {
  OPEN: { label: "Aberto", tone: "info" },
  FOLLOW_UP: { label: "Em acompanhamento", tone: "warn" },
  CLOSED: { label: "Concluído", tone: "ok" },
};

export const NOTE_CATEGORY: LabelMap<NoteCategory> = {
  OBSERVATION: { label: "Observação", tone: "neutral" },
  RECOGNITION: { label: "Reconhecimento", tone: "ok" },
  ALIGNMENT: { label: "Alinhamento", tone: "info" },
  DEVELOPMENT: { label: "Desenvolvimento", tone: "info" },
  OTHER: { label: "Outro", tone: "neutral" },
};

export function options<T extends string>(map: LabelMap<T>): Array<{ value: T; label: string }> {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value].label }));
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
