export type XmtpEmailV1 = {
  v: 1;
  type: 'email';
  subject: string;
  body: string;
  from?: string;
  to?: string;
  sentAt?: number;
};

export type DecodedXmtpEmail =
  | { kind: 'email'; email: XmtpEmailV1 }
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
    const parsed = JSON.parse(trimmed) as Partial<XmtpEmailV1>;
    if (parsed?.type !== 'email' || parsed?.v !== 1) {
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

