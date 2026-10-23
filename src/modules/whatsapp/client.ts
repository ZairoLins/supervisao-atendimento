import { AppError } from "@/lib/errors";

/**
 * Cliente mínimo da Evolution API v2 (WhatsApp não oficial), executada no próprio
 * servidor. A chave da API nunca é registrada em logs nem enviada ao navegador.
 *
 * Endpoints usados:
 *   POST /message/sendText/{instância}   { number, text }
 *   POST /message/sendMedia/{instância}  { number, mediatype, mimetype, media (base64), fileName, caption }
 *   GET  /instance/connectionState/{instância}
 *   GET  /group/fetchAllGroups/{instância}?getParticipants=false
 */

export class WhatsAppError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION");
    this.name = "WhatsAppError";
  }
}

export type WhatsAppDocument = { base64: string; fileName: string; mimetype: string; caption?: string };

/** Interface usada pelos serviços (permite simular o envio em testes). */
export interface WhatsAppSender {
  sendText(to: string, text: string): Promise<void>;
  sendDocument(to: string, doc: WhatsAppDocument): Promise<void>;
  connectionState(): Promise<"open" | "connecting" | "close" | "unknown">;
  fetchGroups(): Promise<Array<{ id: string; subject: string; size: number | null }>>;
}

export type EvolutionConfig = { url: string; apiKey: string; instance: string; timeoutMs?: number };

/** Configuração a partir do ambiente; nula quando o WhatsApp não foi configurado. */
export function evolutionConfigFromEnv(env: Record<string, string | undefined> = process.env): EvolutionConfig | null {
  const url = env.EVOLUTION_API_URL?.trim();
  const apiKey = env.EVOLUTION_API_KEY?.trim();
  const instance = env.EVOLUTION_INSTANCE?.trim();
  if (!url || !apiKey || !instance) return null;
  return { url: url.replace(/\/+$/, ""), apiKey, instance };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { response?: { message?: unknown }; message?: unknown; error?: unknown };
    const raw = body.response?.message ?? body.message ?? body.error;
    const text = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ") : typeof raw === "string" ? raw : "";
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

export function evolutionSender(cfg: EvolutionConfig, fetchImpl: typeof fetch = fetch): WhatsAppSender {
  const instance = encodeURIComponent(cfg.instance);

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.url}${path}`, {
        method,
        headers: { apikey: cfg.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
        cache: "no-store",
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new WhatsAppError(timeout ? "O serviço do WhatsApp demorou para responder. Tente novamente." : "Não foi possível contatar o serviço do WhatsApp (Evolution API). Verifique se ele está em execução.");
    }
    if (res.status === 401 || res.status === 403) throw new WhatsAppError("A Evolution API recusou a chave de acesso (EVOLUTION_API_KEY).");
    if (res.status === 404) throw new WhatsAppError("Instância do WhatsApp não encontrada (EVOLUTION_INSTANCE).");
    if (!res.ok) {
      const detail = await readError(res);
      throw new WhatsAppError(`O WhatsApp recusou o envio${detail ? `: ${detail}` : ` (HTTP ${res.status})`}.`);
    }
    return res.json().catch(() => null);
  }

  return {
    async sendText(to, text) {
      await call("POST", `/message/sendText/${instance}`, { number: to, text });
    },
    async sendDocument(to, doc) {
      await call("POST", `/message/sendMedia/${instance}`, {
        number: to,
        mediatype: "document",
        mimetype: doc.mimetype,
        media: doc.base64,
        fileName: doc.fileName,
        caption: doc.caption ?? "",
      });
    },
    async connectionState() {
      const r = (await call("GET", `/instance/connectionState/${instance}`)) as { instance?: { state?: string }; state?: string } | null;
      const state = r?.instance?.state ?? r?.state;
      return state === "open" || state === "connecting" || state === "close" ? state : "unknown";
    },
    async fetchGroups() {
      const r = await call("GET", `/group/fetchAllGroups/${instance}?getParticipants=false`);
      if (!Array.isArray(r)) return [];
      return r
        .map((g: { id?: unknown; subject?: unknown; size?: unknown }) => ({
          id: typeof g.id === "string" ? g.id : "",
          subject: typeof g.subject === "string" ? g.subject : "(sem nome)",
          size: typeof g.size === "number" ? g.size : null,
        }))
        .filter((g) => g.id.endsWith("@g.us"))
        .sort((a, b) => a.subject.localeCompare(b.subject, "pt-BR"));
    },
  };
}

/**
 * QR Code para conectar o número (GET /instance/connect/{instância}); nulo quando a
 * instância já está conectada. Retorna a imagem como data URL (PNG).
 */
export async function fetchQrCode(cfg: EvolutionConfig, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.url}/instance/connect/${encodeURIComponent(cfg.instance)}`, {
      headers: { apikey: cfg.apiKey },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      cache: "no-store",
    });
  } catch {
    throw new WhatsAppError("Não foi possível obter o QR Code da Evolution API.");
  }
  if (!res.ok) throw new WhatsAppError(`Não foi possível obter o QR Code (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { base64?: unknown } | null;
  return typeof body?.base64 === "string" && body.base64.startsWith("data:image/") ? body.base64 : null;
}

/** Envio configurado pelo ambiente; erro amigável quando ainda não foi configurado. */
export function defaultSender(): WhatsAppSender {
  const cfg = evolutionConfigFromEnv();
  if (!cfg) throw new WhatsAppError("O envio pelo WhatsApp ainda não foi configurado no servidor (EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE).");
  return evolutionSender(cfg);
}
