export type XmtpEmailV1 = {
  v: 1;
  type: 'email';
  subject: string;
  body: string;
  from?: string;
  to?: string;
  sentAt?: number;
};

export type RelayEmailRequest = {
  type: 'email.send.v1';
  to: string[];
  subject: string;
  text: string;
};

export type RelayEmailResult = {
  type: 'email.send.result.v1';
  ok: boolean;
  providerMessageId?: string | null;
  error?: string | null;
};

export type DecodedXmtpEmail =
  | { kind: 'email'; email: XmtpEmailV1 }
  | { kind: 'relay-request'; request: RelayEmailRequest }
  | { kind: 'relay-result'; result: RelayEmailResult }
  | { kind: 'text'; text: string };

export function encodeXmtpEmailV1(input: {
  subject: string;
  body: string;
  from?: string;
  to?: string;
}): string {
  const payload: XmtpEmailV1 = {
    v: 1,
    type: 'email',
    subject: input.subject.trim(),
    body: input.body,
    from: input.from,
    to: input.to,
    sentAt: Date.now(),
  };

  return JSON.stringify(payload);
}

export function decodeXmtpEmail(content: unknown): DecodedXmtpEmail {
  if (typeof content !== 'string') {
    return { kind: 'text', text: String(content ?? '') };
  }

  const trimmed = content.trim();
  if (!trimmed) return { kind: 'text', text: '' };

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.type === 'email.send.v1') {
      const to = Array.isArray(parsed.to) ? parsed.to.filter((value): value is string => typeof value === 'string') : [];
      if (to.length && typeof parsed.subject === 'string' && typeof parsed.text === 'string') {
        return {
          kind: 'relay-request',
          request: { type: 'email.send.v1', to, subject: parsed.subject, text: parsed.text },
        };
      }
    }

    if (parsed.type === 'email.send.result.v1' && typeof parsed.ok === 'boolean') {
      return {
        kind: 'relay-result',
        result: {
          type: 'email.send.result.v1',
          ok: parsed.ok,
          providerMessageId: typeof parsed.providerMessageId === 'string' ? parsed.providerMessageId : null,
          error: typeof parsed.error === 'string' ? parsed.error : null,
        },
      };
    }

    if (parsed.type !== 'email' || parsed.v !== 1) {
      return { kind: 'text', text: content };
    }

    if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      return { kind: 'text', text: content };
    }

    return {
      kind: 'email',
      email: {
        v: 1,
        type: 'email',
        subject: parsed.subject,
        body: parsed.body,
        from: typeof parsed.from === 'string' ? parsed.from : undefined,
        to: typeof parsed.to === 'string' ? parsed.to : undefined,
        sentAt: typeof parsed.sentAt === 'number' ? parsed.sentAt : undefined,
      },
    };
  } catch {
    return { kind: 'text', text: content };
  }
}
