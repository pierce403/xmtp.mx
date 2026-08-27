import { expect, test } from '@playwright/test';
import { encodeEmailSendV1, normalizeRelayInboxId } from '../../lib/xmtpRelay';
import { decodeXmtpEmail } from '../../lib/xmtpEmail';

test('normalizes a public XMTP relay inbox ID without accepting wallet addresses', () => {
  const inboxId = '3af384e3281c4e013ae7ea7095a2b9a843e7f459b1aaf344cd5cf1718261d32b';

  expect(normalizeRelayInboxId(inboxId.toUpperCase())).toBe(inboxId);
  expect(normalizeRelayInboxId(`0x${inboxId}`)).toBe(inboxId);
  expect(normalizeRelayInboxId('0xA1c909598d9A139Dfd685b8b9A9b6f5CbaFf6510')).toBeNull();
  expect(normalizeRelayInboxId('not-an-inbox')).toBeNull();
});

test('encodes the relay email.send.v1 contract exactly', () => {
  expect(
    JSON.parse(
      encodeEmailSendV1({
        to: ' recipient@example.com ',
        subject: ' Hello ',
        text: 'Message body',
      }),
    ),
  ).toEqual({
    type: 'email.send.v1',
    to: ['recipient@example.com'],
    cc: [],
    bcc: [],
    subject: 'Hello',
    text: 'Message body',
    html: null,
    replyTo: null,
  });
});

test('decodes relay requests and delivery receipts for readable UI', () => {
  expect(
    decodeXmtpEmail(JSON.stringify({
      type: 'email.send.v1',
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Hello',
      text: 'Message body',
      html: null,
      replyTo: null,
    })),
  ).toMatchObject({ kind: 'relay-request', request: { to: ['recipient@example.com'], subject: 'Hello' } });

  expect(
    decodeXmtpEmail(JSON.stringify({ type: 'email.send.result.v1', ok: true, mailgunId: 'queued-123', error: null })),
  ).toEqual({
    kind: 'relay-result',
    result: { type: 'email.send.result.v1', ok: true, mailgunId: 'queued-123', error: null },
  });
});
