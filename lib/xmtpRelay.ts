export type EmailSendV1 = {
  type: 'email.send.v1';
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: null;
  replyTo: string | null;
};

export function normalizeRelayInboxId(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^0x/i, '').toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function getRelayInboxId(): string | null {
  if (process.env.NEXT_PUBLIC_CLOUDFLARE_RELAY_READY !== 'true') return null;
  return normalizeRelayInboxId(process.env.NEXT_PUBLIC_XMTP_RELAY_INBOX_ID);
}

export function encodeEmailSendV1(input: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}): string {
  const payload: EmailSendV1 = {
    type: 'email.send.v1',
    to: [input.to.trim()],
    cc: [],
    bcc: [],
    subject: input.subject.trim() || '(no subject)',
    text: input.text,
    html: null,
    replyTo: input.replyTo?.trim() || null,
  };

  return JSON.stringify(payload);
}
