// nodemailer 9 → 10 (dependency-security PR): lib/email.ts sendEmail() exercised end to end over
// real SMTP against a tiny in-process server on loopback. It proves the options the app passes
// (host, port, secure, auth) and the message it sends (from, to, subject, html) still work, and that
// a refused login is reported as DELIVERY_FAILED instead of throwing. Invented addresses only; no
// network beyond 127.0.0.1.
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { sendEmail } from "../lib/email";

type Received = { auth: string | null; from: string | null; to: string[]; data: string };

function smtpServer(acceptAuth: boolean, received: Received[]): Server {
  return createServer((socket: Socket) => {
    const message: Received = { auth: null, from: null, to: [], data: "" };
    let inData = false;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.write("220 invented.smtp.test ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push({ ...message, to: [...message.to] });
            socket.write("250 2.0.0 queued as INVENTED\r\n");
          } else {
            message.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
          continue;
        }
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") socket.write("250-invented.smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (verb === "HELO") socket.write("250 invented.smtp.test\r\n");
        else if (verb === "AUTH") {
          message.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8");
          socket.write(acceptAuth ? "235 2.7.0 accepted\r\n" : "535 5.7.8 invented refusal\r\n");
        } else if (verb === "MAIL") { message.from = line; socket.write("250 2.1.0 ok\r\n"); }
        else if (verb === "RCPT") { message.to.push(line); socket.write("250 2.1.5 ok\r\n"); }
        else if (verb === "DATA") { inData = true; socket.write("354 end with .\r\n"); }
        else if (verb === "QUIT") { socket.end("221 2.0.0 bye\r\n"); }
        else socket.write("250 ok\r\n");
      }
    });
  });
}

const listen = (server: Server) => new Promise<number>((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

const saved: Record<string, string | undefined> = {};
const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
let accepting: Server;
let refusing: Server;
const acceptedMail: Received[] = [];
const refusedMail: Received[] = [];
let acceptPort = 0;
let refusePort = 0;

function configure(port: number) {
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "invented-user",
                               SMTP_PASS: "invented-pass", EMAIL_FROM: "Invented Sender <sender@invented.test>" });
}

before(async () => {
  for (const key of KEYS) saved[key] = process.env[key];
  accepting = smtpServer(true, acceptedMail);
  refusing = smtpServer(false, refusedMail);
  acceptPort = await listen(accepting);
  refusePort = await listen(refusing);
});

after(() => {
  for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  accepting.close();
  refusing.close();
});

describe("sendEmail over SMTP with nodemailer 10", () => {
  it("runs on nodemailer 10.1.4 or later (the patched release)", () => {
    const version = require("nodemailer/package.json").version as string;
    const [major, minor, patch] = version.split(".").map(Number);
    assert.ok(major > 10 || (major === 10 && (minor > 1 || (minor === 1 && patch >= 4))), `nodemailer ${version}`);
  });

  it("delivers a message with the app's options: login, sender, recipient, subject and HTML body", async () => {
    configure(acceptPort);
    const result = await sendEmail({ to: "recipient@invented.test", subject: "Invented reset link",
                                     html: "<p>Invented body</p>" });
    assert.deepEqual(result, { delivered: true });
    assert.equal(acceptedMail.length, 1);
    const [mail] = acceptedMail;
    assert.equal(mail.auth, "\u0000invented-user\u0000invented-pass");          // AUTH PLAIN with the configured login
    assert.match(mail.from ?? "", /MAIL FROM:<sender@invented\.test>/);
    assert.deepEqual(mail.to.map((line) => /<([^>]+)>/.exec(line)?.[1]), ["recipient@invented.test"]);
    assert.match(mail.data, /^Subject: Invented reset link$/m);
    assert.match(mail.data, /^To: recipient@invented\.test$/m);
    assert.match(mail.data, /<p>Invented body<\/p>/);
  });

  it("reports a refused login as DELIVERY_FAILED and sends nothing", async () => {
    configure(refusePort);
    const result = await sendEmail({ to: "recipient@invented.test", subject: "Invented", html: "<p>x</p>" });
    assert.deepEqual(result, { delivered: false, reason: "DELIVERY_FAILED" });
    assert.equal(refusedMail.length, 0);
  });

  it("does nothing when SMTP is not configured", async () => {
    for (const key of KEYS) delete process.env[key];
    assert.deepEqual(await sendEmail({ to: "recipient@invented.test", subject: "x", html: "x" }),
                     { delivered: false, reason: "NOT_CONFIGURED" });
  });
});
