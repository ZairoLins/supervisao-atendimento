/**
 * Modelos editáveis das mensagens do WhatsApp (funções puras: usadas no servidor e na
 * pré-visualização do painel).
 *
 * Sintaxe:
 *   {{variavel}}                      → valor da variável
 *   {{#variavel}} ... {{/variavel}}   → trecho só aparece se a variável tiver valor
 *   {{^variavel}} ... {{/variavel}}   → trecho só aparece se a variável estiver vazia
 * Linhas com apenas uma marcação de bloco somem; 3+ quebras de linha viram uma linha em branco.
 */

export const TEMPLATE_KEYS = ["MEETING_REMINDER", "MEETING_CANCELED", "MEETING_AGENDA", "OCCURRENCES", "MONTHLY_METRICS"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

type Variable = { name: string; description: string; sample: string };

export type TemplateDef = {
  key: TemplateKey;
  label: string;
  target: "Grupo" | "Gestor";
  description: string;
  variables: Variable[];
  defaultBody: string;
};

const MEETING_VARS: Variable[] = [
  { name: "titulo", description: "Título da reunião", sample: "Reunião semanal do Suporte" },
  { name: "quando", description: "Dia da semana, data e horário", sample: "Segunda-feira, 27/10/2026 · 09:00–10:00" },
  { name: "data", description: "Data (DD/MM/AAAA)", sample: "27/10/2026" },
  { name: "dia_semana", description: "Dia da semana", sample: "Segunda-feira" },
  { name: "horario", description: "Horário de início e término", sample: "09:00–10:00" },
  { name: "local", description: "Local ou link (pode estar vazio)", sample: "Sala 2" },
  { name: "codigo", description: "Identificador da reunião", sample: "REU-0012" },
];

const PAUTA: Variable = { name: "pauta", description: "Pauta já formatada para o WhatsApp (pode estar vazia)", sample: "*Abertura*\n☐ Recados da semana\n☐ *Indicadores* de satisfação" };

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  MEETING_REMINDER: {
    key: "MEETING_REMINDER",
    label: "Aviso de reunião",
    target: "Grupo",
    description: "Enviado ao grupo pelo botão “Avisar o grupo” e pelo aviso automático.",
    variables: [...MEETING_VARS, PAUTA],
    defaultBody: `📣 *Lembrete de reunião*

*{{titulo}}*
🗓 {{quando}}
{{#local}}
📍 {{local}}
{{/local}}
{{#pauta}}

*Pauta:*

{{pauta}}
{{/pauta}}

Conto com a presença de todos!`,
  },
  MEETING_CANCELED: {
    key: "MEETING_CANCELED",
    label: "Cancelamento de reunião",
    target: "Grupo",
    description: "Enviado ao grupo ao cancelar uma reunião com a opção de avisar marcada.",
    variables: [...MEETING_VARS, { name: "motivo", description: "Motivo do cancelamento (pode estar vazio)", sample: "Treinamento da equipe no mesmo horário" }],
    defaultBody: `⚠️ *Reunião cancelada*

*{{titulo}}*
🗓 {{quando}}
{{#motivo}}

*Motivo:* {{motivo}}
{{/motivo}}

Assim que houver nova data, aviso por aqui.`,
  },
  MEETING_AGENDA: {
    key: "MEETING_AGENDA",
    label: "Pauta para o gestor",
    target: "Gestor",
    description: "Enviada pelo botão “Enviar pauta ao gestor” na página da reunião.",
    variables: [...MEETING_VARS, PAUTA, { name: "decisoes", description: "Decisões e encaminhamentos, um por linha (pode estar vazio)", sample: "• Revisar a escala de dezembro" }],
    defaultBody: `*Pauta — {{titulo}}*
🗓 {{quando}}
{{#local}}
📍 {{local}}
{{/local}}

{{#pauta}}
{{pauta}}
{{/pauta}}
{{^pauta}}
_Pauta ainda não preenchida._
{{/pauta}}
{{#decisoes}}

*Decisões e encaminhamentos*
{{decisoes}}
{{/decisoes}}

_{{codigo}} · Supervisão de Atendimento_`,
  },
  OCCURRENCES: {
    key: "OCCURRENCES",
    label: "Ocorrências da folha",
    target: "Gestor",
    description: "Texto enviado logo depois do PDF de ocorrências do período da folha (dia 20 ao 19).",
    variables: [
      { name: "periodo", description: "Período da folha", sample: "Folha de 20/09/2026 a 19/10/2026" },
      { name: "tem_ocorrencias", description: "Preenchida quando há ocorrências (use em blocos)", sample: "sim" },
      { name: "total", description: "Total de ocorrências", sample: "7" },
      { name: "colaboradores", description: "Colaboradores com ocorrência", sample: "4" },
      { name: "equipe", description: "Tamanho da equipe", sample: "12" },
      { name: "ausencia", description: "Ausência estimada", sample: "11h 30min" },
      { name: "a_conferir", description: "Ocorrências a conferir (vazio se nenhuma)", sample: "2" },
      { name: "por_tipo", description: "Lista por tipo", sample: "• Atraso: 4\n• Falta: 2\n• Atestado: 1" },
      { name: "por_colaborador", description: "Lista por colaborador", sample: "• Ana Souza: Atraso 2, Falta 1\n• Bruno Lima: Atestado 1" },
    ],
    defaultBody: `*Ocorrências — {{periodo}}*

{{^tem_ocorrencias}}
Nenhuma ocorrência registrada no período.
{{/tem_ocorrencias}}
{{#tem_ocorrencias}}
• Ocorrências: *{{total}}*
• Colaboradores com ocorrência: *{{colaboradores}}* de {{equipe}}
• Ausência estimada: *{{ausencia}}*
{{#a_conferir}}
• A conferir: {{a_conferir}}
{{/a_conferir}}

*Por tipo*
{{por_tipo}}

*Por colaborador*
{{por_colaborador}}
{{/tem_ocorrencias}}`,
  },
  MONTHLY_METRICS: {
    key: "MONTHLY_METRICS",
    label: "Relatório mensal de métricas",
    target: "Gestor",
    description: "Legenda do PDF do relatório mensal enviado ao gestor.",
    variables: [
      { name: "mes", description: "Mês do relatório", sample: "Outubro de 2026" },
      { name: "chamados", description: "Total de chamados", sample: "1.564" },
      { name: "tma", description: "Tempo médio de atendimento (min)", sample: "5,28" },
      { name: "nota", description: "Nota média", sample: "8,62" },
      { name: "avaliacoes", description: "Quantidade de avaliações (vazio em lançamentos antigos)", sample: "128" },
      { name: "colaboradores", description: "Colaboradores no relatório", sample: "12" },
      { name: "semanas", description: "Semanas no mês", sample: "4" },
    ],
    defaultBody: `*Relatório mensal de métricas — {{mes}}*
• Chamados: *{{chamados}}*
• Tempo médio: *{{tma}} min*
• Nota média: *{{nota}}*{{#avaliacoes}} ({{avaliacoes}} avaliações){{/avaliacoes}}
• {{colaboradores}} colaborador(es) · {{semanas}} semana(s)`,
  },
};

export type TemplateVars = Record<string, string | null | undefined>;

// Espaços depois de uma marcação só são descartados quando ela termina a linha
const BLOCK = /\{\{([#^])(\w+)\}\}(?:[ \t]*\n)?([\s\S]*?)\{\{\/\2\}\}((?:[ \t]*\n)?)/;

/** Aplica as variáveis ao modelo. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const filled = (name: string) => Boolean(vars[name]?.trim());
  let out = body.replace(/\r\n/g, "\n");
  // Blocos (internos primeiro quando aninhados com nomes diferentes; repete até não sobrar)
  for (let i = 0; i < 50; i++) {
    const m = BLOCK.exec(out);
    if (!m) break;
    const [whole, kind, name, content, trailing] = m;
    const show = kind === "#" ? filled(name) : !filled(name);
    // Bloco em linhas próprias: a quebra depois do fechamento é descartada (o conteúdo já
    // termina em quebra). Bloco no meio da linha: a quebra é mantida.
    const lineStart = m.index === 0 || out[m.index - 1] === "\n";
    out = out.slice(0, m.index) + (show ? content : "") + (lineStart ? (show && !content.endsWith("\n") ? trailing : "") : trailing) + out.slice(m.index + whole.length);
  }
  out = out.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name]?.trim() ?? "");
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Problemas no modelo: variáveis desconhecidas e blocos sem fechamento. */
export function validateTemplate(key: TemplateKey, body: string): string[] {
  const allowed = new Set(TEMPLATES[key].variables.map((v) => v.name));
  const problems: string[] = [];
  if (!body.trim()) problems.push("A mensagem não pode ficar vazia.");
  const unknown = new Set<string>();
  for (const m of body.matchAll(/\{\{[#^/]?(\w+)\}\}/g)) if (!allowed.has(m[1])) unknown.add(m[1]);
  if (unknown.size) problems.push(`Variável desconhecida: ${[...unknown].map((u) => `{{${u}}}`).join(", ")}.`);
  const stack: string[] = [];
  for (const m of body.matchAll(/\{\{([#^/])(\w+)\}\}/g)) {
    if (m[1] !== "/") stack.push(m[2]);
    else if (stack.pop() !== m[2]) {
      problems.push(`Bloco {{/${m[2]}}} fechado sem abertura correspondente.`);
      return problems;
    }
  }
  if (stack.length) problems.push(`Bloco {{#${stack[stack.length - 1]}}} sem fechamento {{/${stack[stack.length - 1]}}}.`);
  const stray = body.replace(/\{\{[#^/]?\w+\}\}/g, "");
  if (/\{\{|\}\}/.test(stray)) problems.push("Há chaves {{ }} incompletas.");
  return problems;
}

export function sampleVars(key: TemplateKey): TemplateVars {
  return Object.fromEntries(TEMPLATES[key].variables.map((v) => [v.name, v.sample]));
}
