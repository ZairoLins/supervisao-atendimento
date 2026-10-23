import { describe, expect, it } from "vitest";
import { agendaStats, markdownToPlain, markdownToWhatsApp, toggleTaskAtLine } from "@/lib/markdown";
import { parseDateKey, zonedDateTimeToUtc } from "@/lib/dates";
import { evolutionConfigFromEnv, evolutionSender, fetchQrCode, WhatsAppError } from "@/modules/whatsapp/client";
import { normalizePhone } from "@/modules/whatsapp/core";

describe("markdown da pauta", () => {
  const md = "## Abertura\n- [ ] Recados\n- [x] **Indicadores**\n  - [ ] detalhe\n1. Item numerado\n\nTexto com *ênfase* e [link](https://exemplo.com)";

  it("conta itens e discutidos (sem sub-itens)", () => {
    expect(agendaStats(md)).toEqual({ items: 3, done: 1 });
    expect(agendaStats("")).toEqual({ items: 0, done: 0 });
  });

  it("alterna checklist somente em linhas de tarefa", () => {
    expect(toggleTaskAtLine(md, 2)?.split("\n")[1]).toBe("- [x] Recados");
    expect(toggleTaskAtLine(md, 3)?.split("\n")[2]).toBe("- [ ] **Indicadores**");
    expect(toggleTaskAtLine(md, 3, true)?.split("\n")[2]).toBe("- [x] **Indicadores**");
    expect(toggleTaskAtLine(md, 1)).toBeNull();
    expect(toggleTaskAtLine(md, 99)).toBeNull();
  });

  it("gera texto simples para a pesquisa", () => {
    expect(markdownToPlain(md)).toBe("Abertura\nRecados\nIndicadores\ndetalhe\nItem numerado\nTexto com ênfase e link");
  });

  it("converte para a formatação do WhatsApp", () => {
    expect(markdownToWhatsApp(md)).toBe("*Abertura*\n☐ Recados\n☑ *Indicadores*\n   ☐ detalhe\n1. Item numerado\n\nTexto com _ênfase_ e link (https://exemplo.com)");
    expect(markdownToWhatsApp("- item **forte** e ~~velho~~\n---\n```\n**cru**\n```")).toBe("• item *forte* e ~velho~\n──────────\n```\n**cru**\n```");
  });
});

describe("fuso horário", () => {
  it("converte horário local de São Paulo para UTC", () => {
    expect(zonedDateTimeToUtc(parseDateKey("2026-10-23"), 9 * 60, "America/Sao_Paulo").toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(zonedDateTimeToUtc(parseDateKey("2026-10-23"), 23 * 60 + 30, "America/Sao_Paulo").toISOString()).toBe("2026-10-24T02:30:00.000Z");
  });
});

describe("cliente da Evolution API", () => {
  const cfg = { url: "http://evo.local/", apiKey: "segredo", instance: "supervisao" };

  it("lê a configuração do ambiente", () => {
    expect(evolutionConfigFromEnv({})).toBeNull();
    expect(evolutionConfigFromEnv({ EVOLUTION_API_URL: "http://x:8080/", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "i" })).toEqual({ url: "http://x:8080", apiKey: "k", instance: "i" });
  });

  it("envia texto e documento nos endpoints corretos, com a chave no cabeçalho", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ key: { id: "1" } }), { status: 201 });
    }) as unknown as typeof fetch;
    const s = evolutionSender({ ...cfg, url: "http://evo.local" }, fake);
    await s.sendText("5511999998888", "Olá");
    await s.sendDocument("120363@g.us", { base64: "QUJD", fileName: "r.pdf", mimetype: "application/pdf", caption: "c" });
    expect(calls[0].url).toBe("http://evo.local/message/sendText/supervisao");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ number: "5511999998888", text: "Olá" });
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("segredo");
    expect(calls[1].url).toBe("http://evo.local/message/sendMedia/supervisao");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ number: "120363@g.us", mediatype: "document", media: "QUJD", fileName: "r.pdf" });
  });

  it("traduz erros sem expor a chave", async () => {
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(evolutionSender(cfg, reply(401, {})).sendText("1", "x")).rejects.toThrow(/chave de acesso/);
    await expect(evolutionSender(cfg, reply(400, { response: { message: [{ exists: false, number: "55" }] } })).sendText("1", "x")).rejects.toThrow(/exists/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await evolutionSender(cfg, down).sendText("1", "x").catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.message).not.toContain("segredo");
  });

  it("estado da conexão, grupos e QR Code", async () => {
    const fake = (async (url: string) => {
      if (url.includes("connectionState")) return new Response(JSON.stringify({ instance: { instanceName: "supervisao", state: "open" } }));
      if (url.includes("fetchAllGroups")) return new Response(JSON.stringify([{ id: "2@g.us", subject: "Zeta", size: 3 }, { id: "1@g.us", subject: "Suporte Interno", size: 12 }, { id: "x@s.whatsapp.net" }]));
      return new Response(JSON.stringify({ base64: "data:image/png;base64,AAA" }));
    }) as unknown as typeof fetch;
    const s = evolutionSender(cfg, fake);
    expect(await s.connectionState()).toBe("open");
    expect((await s.fetchGroups()).map((g) => g.subject)).toEqual(["Suporte Interno", "Zeta"]);
    expect(await fetchQrCode(cfg, fake)).toBe("data:image/png;base64,AAA");
  });

  it("normaliza telefone", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("5511999998888");
    expect(normalizePhone("+55 11 99999-8888")).toBe("5511999998888");
    expect(normalizePhone("123")).toBeNull();
  });
});
