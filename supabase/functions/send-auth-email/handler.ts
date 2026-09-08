type Message = { to: string[]; subject: string; html: string; text: string };
type Config = {
  configured: boolean;
  supabaseUrl: string;
  siteUrl: string;
  verify: (body: string, headers: Record<string, string>) => unknown;
  send: (message: Message, idempotencyKey: string) => Promise<void>;
};
type EmailPayload = {
  user: { email: string; new_email?: string };
  email_data: { email_action_type: string; token?: string; token_hash?: string; token_hash_new?: string };
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const isEmail = (value: unknown): value is string => typeof value === "string" && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && value.length <= 254;
const actions: Record<string, { title: string; description: string; button: string }> = {
  recovery: { title: "Reset your Pink'D password", description: "Use the secure link below to choose a new password for your Pink'D account.", button: "Reset password" },
  invite: { title: "Set up your Pink'D account", description: "Choose your password to complete your account setup. Your administrator assigns access separately.", button: "Set up account" },
  signup: { title: "Confirm your Pink'D account", description: "Confirm your email address to finish setting up your account.", button: "Confirm email" },
  magiclink: { title: "Sign in to Pink'D", description: "Use this secure link to sign in to your account.", button: "Sign in" },
  email_change: { title: "Confirm your Pink'D email change", description: "Confirm the email change you requested for your account.", button: "Confirm email change" },
  reauthentication: { title: "Confirm your Pink'D account action", description: "Enter this code in the app to confirm your account action.", button: "" },
};

export function buildAuthEmails(payload: unknown, config: Pick<Config, "supabaseUrl" | "siteUrl">): Message[] {
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload");
  const { user, email_data: data } = payload as EmailPayload;
  if (!isEmail(user?.email) || !data || !Object.hasOwn(actions, data.email_action_type)) throw new Error("Invalid email action");
  const action = data.email_action_type;
  const copy = actions[action];
  const site = new URL(config.siteUrl);
  const auth = new URL(config.supabaseUrl);
  if (site.protocol !== "https:" || auth.protocol !== "https:") throw new Error("Invalid configured origin");
  const redirect = new URL(action === "recovery" || action === "invite" ? "/reset-password" : "/pinkd-login", site.origin).href;
  const recipients = action === "email_change"
    ? [ ...(data.token_hash_new ? [{ email: user.email, hash: data.token_hash_new }] : []), { email: user.new_email, hash: data.token_hash } ]
    : [{ email: user.email, hash: data.token_hash }];

  return recipients.map(({ email, hash }) => {
    if (!isEmail(email)) throw new Error("Invalid recipient");
    let content: string;
    let plain: string;
    if (action === "reauthentication") {
      if (typeof data.token !== "string" || !/^\d{6,10}$/.test(data.token)) throw new Error("Invalid code");
      content = `<p style="font-size:30px;font-weight:700">${data.token}</p>`;
      plain = data.token;
    } else {
      if (typeof hash !== "string" || !/^[a-zA-Z0-9_-]{16,512}$/.test(hash)) throw new Error("Invalid token hash");
      // Supabase consumes the token; the app receives its supported recovery session.
      // Never use the request's site_url or redirect_to to build a destination.
      const link = new URL("/auth/v1/verify", auth.origin);
      link.search = new URLSearchParams({ token: hash, type: action, redirect_to: redirect }).toString();
      content = `<p style="margin:28px 0"><a href="${escapeHtml(link.href)}" style="background:#ff007f;color:#000;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">${copy.button}</a></p>`;
      plain = link.href;
    }
    const footer = "This link or code expires. If you did not request this, ignore this email. Never share your link, code or password. For help: universal@hashtag.dance.";
    return {
      to: [email], subject: copy.title,
      text: `${copy.title}\n\n${copy.description}\n\n${plain}\n\n${footer}`,
      html: `<div style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;overflow:hidden"><div style="background:#080808;color:#ff007f;padding:24px;font-size:28px;font-weight:800">PINK'D</div><div style="padding:24px;color:#171717"><h1 style="font-size:24px">${escapeHtml(copy.title)}</h1><p>${copy.description}</p>${content}<p style="font-size:13px;color:#555">${footer}</p></div></div></div>`,
    };
  });
}

export function createAuthEmailHandler(config: Config) {
  const reply = (status: number, message?: string) => Response.json(message ? { error: { http_code: status, message } } : {}, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply(405, "Method not allowed");
    if (!config.configured) return reply(503, "Account email is not configured");
    const body = await request.text();
    if (body.length > 65536) return reply(413, "Request too large");
    let payload: unknown;
    try {
      payload = config.verify(body, Object.fromEntries(request.headers));
    } catch {
      return reply(401, "Invalid email hook signature");
    }
    let messages: Message[];
    try {
      messages = buildAuthEmails(payload, config);
    } catch {
      return reply(400, "Invalid account email request");
    }
    try {
      for (const message of messages) {
        // The provider deduplicates retries without storing credentials or OTPs locally.
        const bytes = new TextEncoder().encode(`${request.headers.get("webhook-id")}\n${message.to[0]}\n${body}`);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        const key = "pinkd-auth-" + Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
        await config.send(message, key);
      }
      return reply(200);
    } catch {
      // Do not log the signed request, token, recipient, or provider response.
      return reply(502, "Account email could not be sent. Please retry shortly.");
    }
  };
}
