import { Client } from '@xmtp/xmtp-js';
import { ethers } from 'ethers';

import { isHexAddress, parseRecipient } from '../lib/xmtpAddressing';
import { encodeXmtpEmailV1 } from '../lib/xmtpEmail';

export type InboundEmailPayload = {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  raw?: unknown;
};

export type ForwardEmailToXmtpOptions = {
  botPrivateKey: string;
  xmtpEnv?: 'local' | 'dev' | 'production';
  ethereumRpcUrl?: string;
};

export async function forwardEmailToXmtp(payload: InboundEmailPayload, options: ForwardEmailToXmtpOptions) {
  if (!payload?.to) {
    throw new Error('Missing "to".');
  }

  const recipient = parseRecipient(payload.to);
  if (recipient.kind === 'invalid') {
    throw new Error(recipient.error);
  }
  if (recipient.kind === 'smtp') {
    throw new Error('Recipient is not an @xmtp.mx address.');
  }

  const env = options.xmtpEnv ?? 'production';
  const wallet = new ethers.Wallet(options.botPrivateKey);
  const xmtp = await Client.create(wallet, { env });

  const ensProvider = options.ethereumRpcUrl
    ? new ethers.JsonRpcProvider(options.ethereumRpcUrl)
    : ethers.getDefaultProvider('mainnet');

  const peerAddress = isHexAddress(recipient.peer) ? recipient.peer : await ensProvider.resolveName(recipient.peer);
  if (!peerAddress) {
    throw new Error(`Could not resolve "${recipient.peer}".`);
  }

  const conversation = await xmtp.conversations.newConversation(peerAddress);
  const body = payload.text ?? payload.html ?? (payload.raw ? JSON.stringify(payload.raw) : '');
  const message = await conversation.send(
    encodeXmtpEmailV1({
      subject: payload.subject?.trim() || '(no subject)',
      body,
      from: payload.from,
      to: payload.to,
    }),
  );

  return {
    to: payload.to,
    peerAddress,
    conversationTopic: conversation.topic,
    xmtpMessageId: message.id,
  };
}

