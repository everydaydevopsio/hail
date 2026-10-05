import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";

export type SendMail = (recipient: string, raw: string) => Promise<void>;
type Token = {
  email: string;
  nonce?: string;
  kind: "login" | "invite";
  expires: number;
  used: boolean;
  revoked: boolean;
};
type Session = { email: string; role: string; organization: string };
const random = () => randomBytes(24).toString("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const cookies = (request: IncomingMessage) =>
  Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=")),
  );

export interface DemoApp {
  origin: string;
  adminCookie: { name: string; value: string; url: string };
  expire(url: string): void;
  revoke(url: string): void;
  close(): Promise<void>;
}

/** Loopback-only test fixture, not a production authentication server. */
export async function startDemoApp(
  send: SendMail,
  from = "login@example.test",
): Promise<DemoApp> {
  if (/[\r\n]/.test(from)) throw new Error("Invalid test sender.");
  const tokens = new Map<string, Token>();
  const sessions = new Map<string, Session>();
  const adminId = random();
  sessions.set(adminId, {
    email: "admin@example.test",
    role: "admin",
    organization: "Hail",
  });
  let origin = "";
  const respond = (response: ServerResponse, status: number, html: string) => {
    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      const session = sessions.get(cookies(request).session);
      if (request.method === "GET" && url.pathname === "/login") {
        respond(
          response,
          200,
          '<form method="post" action="/login"><label>Email<input name="email" type="email" required></label><button>Send magic link</button></form>',
        );
      } else if (request.method === "GET" && url.pathname === "/admin") {
        if (session?.role !== "admin")
          return respond(response, 403, "Not an administrator");
        respond(
          response,
          200,
          '<form method="post" action="/invite"><label>Invite email<input name="email" type="email" required></label><button>Invite member</button></form>',
        );
      } else if (
        request.method === "POST" &&
        ["/login", "/invite"].includes(url.pathname)
      ) {
        if (url.pathname === "/invite" && session?.role !== "admin")
          return respond(response, 403, "Not an administrator");
        if (request.headers.origin && request.headers.origin !== origin)
          return respond(response, 403, "Wrong origin");
        let body = "";
        for await (const chunk of request) {
          body += chunk.toString();
          if (body.length > 2048)
            return respond(response, 413, "Request too large");
        }
        const email =
          new URLSearchParams(body).get("email")?.toLowerCase() ?? "";
        if (!/^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9.-]+$/.test(email))
          return respond(response, 400, "Invalid email");
        const kind = url.pathname === "/login" ? "login" : "invite";
        const nonce = kind === "login" ? random() : undefined;
        const id = random();
        for (const token of tokens.values()) {
          if (token.email === email && token.kind === kind)
            token.revoked = true;
        }
        tokens.set(id, {
          email,
          nonce,
          kind,
          expires: Date.now() + 5 * 60_000,
          used: false,
          revoked: false,
        });
        const path = kind === "login" ? "/auth/callback" : "/accept";
        const link = `${origin}${path}?token=${id}`;
        const label = kind === "login" ? "Sign in" : "Accept invitation";
        const subject =
          kind === "login" ? "Sign in to Hail" : "Invitation to Hail";
        const raw = [
          `From: ${from}`,
          `To: ${email}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          "Content-Type: text/html; charset=utf-8",
          "",
          `<p>${label}</p><a href="${escape(link)}">${label}</a>`,
        ].join("\r\n");
        await send(email, raw);
        if (nonce)
          response.setHeader(
            "Set-Cookie",
            `request_nonce=${nonce}; HttpOnly; SameSite=Lax; Path=/`,
          );
        respond(response, 200, '<p data-testid="sent">Check your email</p>');
      } else if (
        request.method === "GET" &&
        ["/auth/callback", "/accept"].includes(url.pathname)
      ) {
        const token = tokens.get(url.searchParams.get("token") ?? "");
        const expectedKind = url.pathname === "/accept" ? "invite" : "login";
        if (
          !token ||
          token.kind !== expectedKind ||
          token.used ||
          token.revoked ||
          token.expires < Date.now()
        )
          return respond(
            response,
            410,
            '<p data-testid="invalid-link">This link is no longer valid</p>',
          );
        if (
          token.kind === "login" &&
          cookies(request).request_nonce !== token.nonce
        )
          return respond(
            response,
            403,
            "Request this link in the same browser",
          );
        token.used = true;
        const id = random();
        sessions.set(id, {
          email: token.email,
          role: token.kind === "invite" ? "viewer" : "member",
          organization: "Hail",
        });
        response.writeHead(302, {
          Location: "/dashboard",
          "Set-Cookie": `session=${id}; HttpOnly; SameSite=Lax; Path=/`,
          "Cache-Control": "no-store",
        });
        response.end();
      } else if (request.method === "GET" && url.pathname === "/dashboard") {
        if (!session) return respond(response, 401, "Sign in required");
        respond(
          response,
          200,
          `<p data-testid="current-user-email">${escape(session.email)}</p><p data-testid="role">${session.role}</p><p data-testid="organization">${session.organization}</p>`,
        );
      } else respond(response, 404, "Not found");
    })().catch(() => {
      // Never print raw MIME, addresses, cookies, or token-bearing request URLs.
      if (!response.headersSent)
        respond(
          response,
          500,
          "Test application failed to send or process email",
        );
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test application failed to bind.");
  origin = `http://127.0.0.1:${address.port}`;
  const findToken = (url: string) => {
    const token = tokens.get(new URL(url).searchParams.get("token") ?? "");
    if (!token) throw new Error("Unknown test token.");
    return token;
  };
  return {
    origin,
    adminCookie: { name: "session", value: adminId, url: origin },
    expire: (url) => {
      findToken(url).expires = Date.now() - 1;
    },
    revoke: (url) => {
      findToken(url).revoked = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
