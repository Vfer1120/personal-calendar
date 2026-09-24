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