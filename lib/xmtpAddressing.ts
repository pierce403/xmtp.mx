export type Recipient =
  | {
      kind: 'xmtp';
      peer: string;
    }
  | {
      kind: 'smtp';
      email: string;
    }
  | {
      kind: 'invalid';
      error: string;
    };

export function parseRecipient(input: string): Recipient {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: 'invalid', error: 'Recipient is required.' };
  }

  const at = trimmed.lastIndexOf('@');
  if (at === -1) {
    return { kind: 'xmtp', peer: trimmed };
  }

  const local = trimmed.slice(0, at).trim();
  const domain = trimmed.slice(at + 1).trim().toLowerCase();

  if (!local || !domain) {
    return { kind: 'invalid', error: 'Invalid email address.' };
  }

  if (domain === 'xmtp.mx') {
    return { kind: 'xmtp', peer: local };
  }

  return { kind: 'smtp', email: trimmed };
}

export function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function shortenAddress(value: string, options?: { chars?: number }): string {
  const chars = options?.chars ?? 4;
  if (!isHexAddress(value)) return value;
  return `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
}

