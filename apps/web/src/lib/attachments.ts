import { api, apiJson } from "./api";

export interface AttachmentRecord { id: string; itemId: string; fileName: string; mimeType: string; size: number; createdAt: string; }

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(value: string) {
  return crypto.subtle.importKey("raw", base64ToBytes(value) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function uploadAttachment(itemId: string, file: File): Promise<AttachmentRecord> {
  const init = await apiJson<{ attachmentId: string; uploadUrl: string; uploadToken: string; dataKey: string; headers: Record<string, string> }>(`/api/v1/items/${itemId}/attachments/init`, "POST", { fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size });
  const key = await importKey(init.dataKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await file.arrayBuffer();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const ciphertext = encrypted.slice(0, -16);
  const authTag = encrypted.slice(-16);
  const upload = await fetch(init.uploadUrl, { method: "PUT", headers: init.headers, body: ciphertext });
  if (!upload.ok) throw new Error(`附件上传失败 (${upload.status})`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
  const response = await apiJson<{ attachment: AttachmentRecord }>(`/api/v1/attachments/${init.attachmentId}/finalize`, "POST", { uploadToken: init.uploadToken, fileName: file.name, mimeType: file.type || "application/octet-stream", size: ciphertext.byteLength, dataKey: init.dataKey, iv: bytesToBase64(iv), authTag: bytesToBase64(authTag), sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") });
  return response.attachment;
}

async function decryptAttachment(id: string): Promise<{ blob: Blob; record: { fileName: string; mimeType: string } }> {
  const { attachment } = await apiJson<{ attachment: { id: string; fileName: string; mimeType: string; dataKey: string; iv: string; authTag: string; downloadUrl: string } }>(`/api/v1/attachments/${id}/access`, "GET");
  const response = await fetch(attachment.downloadUrl);
  if (!response.ok) throw new Error(`附件下载失败 (${response.status})`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const tag = base64ToBytes(attachment.authTag);
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext); encrypted.set(tag, ciphertext.length);
  const key = await importKey(attachment.dataKey);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(attachment.iv) as BufferSource }, key, encrypted as BufferSource);
  return { blob: new Blob([plaintext], { type: attachment.mimeType }), record: attachment };
}

export async function openAttachment(id: string) {
  const { blob, record } = await decryptAttachment(id);
  const url = URL.createObjectURL(blob);
  const target = window.open(url, "_blank");
  if (!target) {
    const link = document.createElement("a"); link.href = url; link.download = record.fileName; link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}

export async function getAttachmentPreviewUrl(id: string) {
  const { blob } = await decryptAttachment(id);
  return URL.createObjectURL(blob);
}