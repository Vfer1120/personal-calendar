export interface BrevoEmailInput {
  apiKey: string;
  sender: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
}

export async function sendBrevoEmail(input: BrevoEmailInput): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": input.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: input.sender, to: [{ email: input.to }], subject: input.subject, textContent: input.text })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`邮件服务发送失败（${response.status}）${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}
export interface Smtp2goEmailInput {
  apiKey: string;
  sender: string;
  to: string;
  subject: string;
  text: string;
}

export async function sendSmtp2goEmail(input: Smtp2goEmailInput): Promise<void> {
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: input.apiKey, sender: input.sender, to: [input.to], subject: input.subject, text_body: input.text })
  });
  const payload = await response.json().catch(() => null) as { data?: { succeeded?: number; failures?: unknown[] } } | null;
  if (!response.ok || (payload?.data?.succeeded ?? 0) < 1) {
    throw new Error(`邮件服务发送失败（${response.status}）`);
  }
}
export interface MailjetEmailInput {
  apiKey: string;
  secretKey: string;
  sender: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
}

export async function sendMailjetEmail(input: MailjetEmailInput): Promise<void> {
  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${input.apiKey}:${input.secretKey}`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Messages: [{ From: input.sender, To: [{ Email: input.to }], Subject: input.subject, TextPart: input.text }] })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`邮件服务发送失败（${response.status}）${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}