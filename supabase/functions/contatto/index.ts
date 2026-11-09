// Edge Function "contatto": riceve il modulo di glevantis.it, salva su
// public.richieste_sito e avvisa info@glevantis.it via SMTP Aruba.
// Secret richiesti: SMTP_USER, SMTP_PASS, IP_SALT (SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY sono già iniettati dalla piattaforma).
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const ALLOWED_ORIGINS = [
  "https://glevantis.it",
  "https://www.glevantis.it",
  "https://arturof94.github.io",
];
const MAIL_TO = "info@glevantis.it";
const MAX_PER_HOUR = 5;
const LIMITS = { nome: 120, azienda: 160, email: 254, telefono: 40, messaggio: 5000, pagina: 200 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    ""
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const originOk = !!origin && ALLOWED_ORIGINS.includes(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  }
  if (req.method !== "POST") return json({ ok: false, error: "metodo non ammesso" }, 405, cors);
  // Origin presente ma non ammessa: rifiuta. (Un submit HTML classico verso un
  // altro host invia Origin; chi non lo invia, es. curl, è soggetto a rate limit.)
  if (origin && !originOk) return json({ ok: false, error: "origine non ammessa" }, 403, cors);

  const ct = req.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  let data: Record<string, unknown> = {};
  try {
    if (isJson) {
      data = await req.json();
    } else {
      data = Object.fromEntries((await req.formData()).entries());
    }
  } catch {
    return json({ ok: false, error: "richiesta non valida" }, 400, cors);
  }

  // Dove rimandare un submit HTML classico
  const siteBase = originOk
    ? origin!
    : (() => {
      try {
        const r = req.headers.get("referer");
        const o = r ? new URL(r).origin : "";
        return ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
      } catch {
        return ALLOWED_ORIGINS[0];
      }
    })();
  const done = () =>
    isJson
      ? json({ ok: true }, 200, cors)
      : new Response(null, {
        status: 303,
        headers: { ...cors, Location: `${siteBase}/contatti.html?inviato=1` },
      });
  const fail = (msg: string, status = 400) =>
    isJson
      ? json({ ok: false, error: msg }, status, cors)
      : new Response(null, {
        status: 303,
        headers: { ...cors, Location: `${siteBase}/contatti.html?errore=${status === 429 ? "limite" : "dati"}` },
      });

  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : "");

  // Honeypot: finta risposta ok, niente salvataggio
  if (str("_gotcha") !== "") return done();

  const nome = str("nome");
  const azienda = str("azienda");
  const email = str("email");
  const telefono = str("telefono");
  const messaggio = str("messaggio");
  const pagina = (str("pagina") || req.headers.get("referer") || "").slice(0, LIMITS.pagina);

  if (!nome || !azienda || !email || !messaggio) return fail("campi obbligatori mancanti");
  if (
    nome.length > LIMITS.nome || azienda.length > LIMITS.azienda ||
    email.length > LIMITS.email || telefono.length > LIMITS.telefono ||
    messaggio.length > LIMITS.messaggio
  ) return fail("campo troppo lungo");
  if (!EMAIL_RE.test(email) || /[\r\n]/.test(email)) return fail("email non valida");

  // Rate limit per IP
  const ipHash = await sha256Hex(`${Deno.env.get("IP_SALT") ?? ""}|${clientIp(req)}`);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: cErr } = await supabase
    .from("richieste_sito")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("creato_il", since);
  if (cErr) {
    console.error("rate limit query", cErr.message);
    return fail("errore temporaneo", 500);
  }
  if ((count ?? 0) >= MAX_PER_HOUR) return fail("troppe richieste, riprova più tardi", 429);

  const { error: iErr } = await supabase.from("richieste_sito").insert({
    nome, azienda, email, telefono, messaggio, pagina, ip_hash: ipHash,
  });
  if (iErr) {
    console.error("insert", iErr.message);
    return fail("errore temporaneo", 500);
  }

  // Mail: se fallisce la riga resta salvata
  try {
    const user = Deno.env.get("SMTP_USER");
    const pass = Deno.env.get("SMTP_PASS");
    if (!user || !pass) throw new Error("SMTP_USER/SMTP_PASS non impostati");
    const transporter = nodemailer.createTransport({
      host: "smtps.aruba.it",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `Sito Glevantis <${user}>`,
      to: MAIL_TO,
      replyTo: `${nome.replace(/[<>"\r\n]/g, "")} <${email}>`,
      subject: `Nuova richiesta dal sito: ${azienda}`.replace(/[\r\n]/g, " "),
      text: `Nome: ${nome}\nAzienda: ${azienda}\nEmail: ${email}\nTelefono: ${telefono || "-"}\nPagina: ${pagina || "-"}\n\n${messaggio}\n`,
      html: `<p><b>Nome:</b> ${esc(nome)}<br><b>Azienda:</b> ${esc(azienda)}<br><b>Email:</b> ${esc(email)}<br><b>Telefono:</b> ${esc(telefono || "-")}<br><b>Pagina:</b> ${esc(pagina || "-")}</p><p style="white-space:pre-wrap">${esc(messaggio)}</p>`,
    });
  } catch (e) {
    console.error("invio mail fallito", e instanceof Error ? e.message : String(e));
  }

  return done();
});
