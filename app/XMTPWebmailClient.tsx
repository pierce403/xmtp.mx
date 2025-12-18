'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Client,
  ConsentState,
  ConversationType,
  DecodedMessage,
  Dm,
  Identifier,
  IdentifierKind,
  SortDirection,
} from '@xmtp/browser-sdk';
import { ethers } from 'ethers';
import { useActiveAccount, useActiveWallet, ConnectButton } from 'thirdweb/react';
import { EIP1193 } from 'thirdweb/wallets';
import { ethereum } from 'thirdweb/chains';
import { THIRDWEB_CLIENT_ID, thirdwebAppMetadata, thirdwebClient } from '@/lib/thirdwebClient';
import { decodeXmtpEmail, encodeXmtpEmailV1 } from '@/lib/xmtpEmail';
import { isHexAddress, parseRecipient, shortenAddress } from '@/lib/xmtpAddressing';

type ThirdwebClientIdStatus = 'missing' | 'checking' | 'valid' | 'invalid';

type StartupStatusTone = 'ok' | 'pending' | 'error' | 'neutral';

type InboxDetailsMap = Record<string, { address?: string; identifiers?: Identifier[] }>; 

type ConversationSummary = {
  conversation: Dm;
  peerInboxId?: string;
  peerAddress?: string;
  lastMessage?: DecodedMessage;
};

function toneDotClass(tone: StartupStatusTone) {
  switch (tone) {
    case 'ok':
      return 'bg-green-500';
    case 'error':
      return 'bg-red-500';
    case 'pending':
      return 'bg-amber-500';
    default:
      return 'bg-neutral-300';
  }
}

function nsToDate(ns?: bigint) {
  if (!ns) return undefined;
  return new Date(Number(ns / 1_000_000n));
}

function findEthereumAddress(identifiers: Identifier[] | undefined) {
  if (!identifiers) return undefined;
  const eth = identifiers.find((id) => id.identifierKind === IdentifierKind.Ethereum);
  return eth?.identifier;
}

function shortenInboxId(inboxId: string) {
  if (inboxId.length <= 10) return inboxId;
  return `${inboxId.slice(0, 6)}…${inboxId.slice(-4)}`;
}

function StartupStatusPanel({
  activeAddress,
  clientAddress,
  clientError,
  conversationsCount,
  hasActiveWallet,
  isLoading,
  isWasmInitialized,
  thirdwebClient,
  thirdwebClientIdError,
  thirdwebClientIdStatus,
  wasmError,
  wasmInitStalled,
  xmtpEnv,
  xmtpInitStalled,
}: {
  activeAddress?: string;
  clientAddress?: string;
  clientError?: string;
  conversationsCount: number;
  hasActiveWallet: boolean;
  isLoading: boolean;
  isWasmInitialized: boolean;
  thirdwebClient: boolean;
  thirdwebClientIdError: string | null;
  thirdwebClientIdStatus: ThirdwebClientIdStatus;
  wasmError: string | null;
  wasmInitStalled: boolean;
  xmtpEnv: 'local' | 'dev' | 'production';
  xmtpInitStalled: boolean;
}) {
  const thirdwebLabel =
    thirdwebClientIdStatus === 'valid'
      ? 'Valid'
      : thirdwebClientIdStatus === 'checking'
        ? 'Checking…'
        : thirdwebClientIdStatus === 'missing'
          ? 'Missing'
          : `Invalid${thirdwebClientIdError ? ` (${thirdwebClientIdError})` : ''}`;

  const items = [
    { label: 'Environment', value: xmtpEnv, tone: 'neutral' as const },
    {
      label: 'Security module (WASM)',
      value: wasmError
        ? `Error: ${wasmError}`
        : isWasmInitialized
          ? 'Ready'
          : wasmInitStalled
            ? 'Loading (taking longer than usual)'
            : 'Loading',
      tone: wasmError ? ('error' as const) : isWasmInitialized ? ('ok' as const) : ('pending' as const),
    },
    { label: 'thirdweb client', value: thirdwebClient ? 'Ready' : 'Missing', tone: thirdwebClient ? ('ok' as const) : ('error' as const) },
    {
      label: 'thirdweb client ID',
      value: thirdwebLabel,
      tone:
        thirdwebClientIdStatus === 'valid'
          ? ('ok' as const)
          : thirdwebClientIdStatus === 'invalid'
            ? ('error' as const)
            : ('pending' as const),
    },
    {
      label: 'Wallet',
      value: activeAddress ? shortenAddress(activeAddress) : 'Not connected',
      tone: activeAddress ? ('ok' as const) : ('pending' as const),
    },
    { label: 'Wallet provider', value: hasActiveWallet ? 'Ready' : 'Waiting…', tone: hasActiveWallet ? ('ok' as const) : ('pending' as const) },
    {
      label: 'XMTP client',
      value: clientAddress
        ? `Ready (${shortenAddress(clientAddress)})`
        : clientError
          ? `Error: ${clientError}`
          : isLoading
            ? xmtpInitStalled
              ? 'Initializing (taking longer than usual)'
              : 'Initializing…'
            : 'Idle (waiting to start)',
      tone: clientAddress ? ('ok' as const) : clientError ? ('error' as const) : ('pending' as const),
    },
    { label: 'Conversations', value: String(conversationsCount), tone: 'neutral' as const },
  ] as const satisfies readonly { label: string; value: string; tone: StartupStatusTone }[];

  const diagnosticsText = useMemo(
    () =>
      JSON.stringify(
        {
          xmtpEnv,
          thirdwebClient,
          thirdwebClientIdStatus,
          thirdwebClientIdError,
          activeAddress: activeAddress ?? null,
          activeWallet: hasActiveWallet,
          wasmReady: isWasmInitialized,
          wasmInitStalled,
          wasmError,
          xmtpLoading: isLoading,
          xmtpInitStalled,
          xmtpError: clientError ?? null,
          clientAddress: clientAddress ?? null,
          conversations: conversationsCount,
          userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        },
        null,
        2,
      ),
    [
      activeAddress,
      clientAddress,
      clientError,
      conversationsCount,
      hasActiveWallet,
      isLoading,
      isWasmInitialized,
      thirdwebClient,
      thirdwebClientIdError,
      thirdwebClientIdStatus,
      wasmError,
      wasmInitStalled,
      xmtpEnv,
      xmtpInitStalled,
    ],
  );

  return (
    <div className="mt-4 w-full max-w-xl rounded-2xl border bg-white px-4 py-3 text-left shadow-sm ring-1 ring-black/5">
      <div className="text-sm font-semibold text-neutral-900">Startup status</div>
      <div className="mt-2 space-y-2 text-xs text-neutral-700">
        {items.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={['mt-0.5 h-2 w-2 shrink-0 rounded-full', toneDotClass(item.tone)].join(' ')} />
              <span className="shrink-0 font-semibold text-neutral-800">{item.label}</span>
            </div>
            <div className="min-w-0 text-right text-neutral-700">
              <span className="break-words">{item.value}</span>
            </div>
          </div>
        ))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs font-semibold text-neutral-700">Debug details</summary>
        <div className="mt-2 text-[11px] text-neutral-600">
          Enable console logs:{' '}
          <code className="rounded bg-neutral-100 px-1 py-0.5">
            {"localStorage.setItem('xmtp.mx.debug','1')"}
          </code>
        </div>
        <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-neutral-950 px-3 py-2 text-[11px] text-neutral-100">
          {diagnosticsText}
        </pre>
      </details>
    </div>
  );
}

function ThirdwebClientIdBanner({
  status,
  error,
}: {
  status: ThirdwebClientIdStatus;
  error: string | null;
}) {
  if (status !== 'missing' && status !== 'invalid') return null;

  return (
    <div className="sticky top-0 z-[60] border-b border-red-700/40 bg-red-600 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {status === 'missing' ? 'Missing thirdweb client ID' : 'Invalid thirdweb client ID'}
          </div>
          <div className="mt-0.5 text-xs text-white/90">
            {status === 'missing' ? (
              <>
                Set <code className="rounded bg-white/15 px-1 py-0.5">NEXT_PUBLIC_THIRDWEB_CLIENT_ID</code> and rebuild
                (GitHub Pages: add a repo secret and redeploy).
              </>
            ) : (
              <>
                thirdweb RPC rejected the client ID{error ? ` (${error})` : ''}. Check the value and redeploy.
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            className="inline-flex items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
            href="https://thirdweb.com/create-api-key"
            target="_blank"
            rel="noreferrer"
          >
            Get a key
          </a>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(date?: Date): string {
  if (!date) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return isToday
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

type ThreadProps = {
  conversation: Dm;
  messages: DecodedMessage[];
  selfInboxId?: string;
  inboxDetails: InboxDetailsMap;
  onReply: (options: { subject?: string; body: string }) => Promise<void>;
};

function Thread({ conversation, messages, selfInboxId, inboxDetails, onReply }: ThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setSendError(null);
    setReplyBody('');
  }, [conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const senderLabel = useCallback(
    (inboxId: string) => {
      if (selfInboxId && inboxId === selfInboxId) return 'You';
      const detail = inboxDetails[inboxId];
      if (detail?.address) return shortenAddress(detail.address);
      return shortenInboxId(inboxId);
    },
    [inboxDetails, selfInboxId],
  );

  const handleSendReply = async () => {
    if (!replyBody.trim()) return;
    setSendError(null);
    setIsSending(true);
    try {
      await onReply({ body: replyBody });
      setReplyBody('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <div className="border-b px-5 py-4">
        <div className="text-sm font-semibold text-neutral-900">{shortenInboxId(conversation.id)}</div>
        <div className="text-xs text-neutral-500">XMTP thread</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="text-sm text-neutral-500">No messages yet.</div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isSelf = selfInboxId ? message.senderInboxId === selfInboxId : false;
              const decoded = decodeXmtpEmail(message.content);
              const sentAt = nsToDate(message.sentAtNs);

              return (
                <div key={message.id} className={['flex', isSelf ? 'justify-end' : 'justify-start'].join(' ')}>
                  <div
                    className={[
                      'max-w-[720px] rounded-2xl border px-4 py-3 shadow-sm',
                      isSelf ? 'border-blue-200 bg-blue-50' : 'border-neutral-200 bg-white',
                    ].join(' ')}
                  >
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs text-neutral-500">
                      <div className="truncate">{isSelf ? 'You' : senderLabel(message.senderInboxId)}</div>
                      <div className="shrink-0">{formatTimestamp(sentAt)}</div>
                    </div>

                    {decoded.kind === 'email' ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-neutral-900">
                          {decoded.email.subject || '(no subject)'}
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-neutral-900">{decoded.email.body}</div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm text-neutral-900">{decoded.text}</div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t p-4">
        {sendError ? <div className="mb-2 text-xs text-red-600">{sendError}</div> : null}
        <div className="flex gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            placeholder="Reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.currentTarget.value)}
          />
          <button
            type="button"
            className="h-[44px] shrink-0 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => void handleSendReply()}
            disabled={!replyBody.trim() || isSending}
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

const XMTPWebmailClient: React.FC = () => {
  const [isWasmInitialized, setIsWasmInitialized] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [wasmInitStalled, setWasmInitStalled] = useState(false);
  const [xmtpInitStalled, setXmtpInitStalled] = useState(false);
  const [thirdwebClientIdStatus, setThirdwebClientIdStatus] = useState<ThirdwebClientIdStatus>(() =>
    (THIRDWEB_CLIENT_ID ?? '').trim() ? 'checking' : 'missing',
  );
  const [thirdwebClientIdError, setThirdwebClientIdError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeIsSending, setComposeIsSending] = useState(false);
  const [search, setSearch] = useState('');
  const [xmtpClient, setXmtpClient] = useState<Client | null>(null);
  const [xmtpError, setXmtpError] = useState<string | null>(null);
  const [xmtpLoading, setXmtpLoading] = useState(false);
  const [conversationsById, setConversationsById] = useState<Record<string, ConversationSummary>>({});
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, DecodedMessage[]>>({});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [inboxDetails, setInboxDetails] = useState<InboxDetailsMap>({});

  const inboxDetailsRef = useRef(inboxDetails);
  useEffect(() => {
    inboxDetailsRef.current = inboxDetails;
  }, [inboxDetails]);

  const messageStreamRef = useRef<AsyncIterator<DecodedMessage> | null>(null);
  const conversationStreamRef = useRef<AsyncIterator<Dm> | null>(null);

  const xmtpEnv = (process.env.NEXT_PUBLIC_XMTP_ENV ?? 'production') as 'local' | 'dev' | 'production';

  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();

  const debugEnabled = useMemo(() => {
    if (process.env.NEXT_PUBLIC_DEBUG === '1') return true;
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('xmtp.mx.debug') === '1';
    } catch {
      return false;
    }
  }, []);

  const debug = useCallback(
    (...args: unknown[]) => {
      if (!debugEnabled) return;
      console.debug('[xmtp.mx]', ...args);
    },
    [debugEnabled],
  );

  const activeAddress = activeAccount?.address;
  const hasActiveWallet = Boolean(activeWallet);
  const clientAddress = useMemo(() => {
    const identifier = xmtpClient?.accountIdentifier;
    if (identifier?.identifierKind === IdentifierKind.Ethereum) return identifier.identifier;
    return undefined;
  }, [xmtpClient]);

  useEffect(() => {
    if (!debugEnabled) return;
    console.info('[xmtp.mx] Debug logging enabled (set localStorage "xmtp.mx.debug" = "1" to toggle).');
  }, [debugEnabled]);

  useEffect(() => {
    debug('state', {
      xmtpEnv,
      thirdwebClient: Boolean(thirdwebClient),
      thirdwebClientIdStatus,
      thirdwebClientIdError,
      activeAddress,
      hasActiveWallet,
      wasmReady: isWasmInitialized,
      wasmInitStalled,
      wasmError,
      xmtpLoading,
      xmtpInitStalled,
      xmtpError,
      clientAddress,
      conversations: Object.keys(conversationsById).length,
    });
  }, [
    activeAddress,
    clientAddress,
    debug,
    hasActiveWallet,
    isWasmInitialized,
    wasmInitStalled,
    thirdwebClientIdError,
    thirdwebClientIdStatus,
    wasmError,
    xmtpInitStalled,
    xmtpEnv,
    xmtpError,
    xmtpLoading,
    conversationsById,
  ]);

  useEffect(() => {
    const clientId = (THIRDWEB_CLIENT_ID ?? '').trim();
    if (!clientId) {
      setThirdwebClientIdStatus('missing');
      setThirdwebClientIdError(null);
      debug('thirdweb client ID missing; wallet connect disabled');
      return;
    }

    const controller = new AbortController();

    const validate = async () => {
      setThirdwebClientIdStatus('checking');
      setThirdwebClientIdError(null);
      debug('validating thirdweb client ID');

      try {
        const res = await fetch(`https://1.rpc.thirdweb.com/${clientId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_chainId',
            params: [],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          setThirdwebClientIdStatus('invalid');
          setThirdwebClientIdError(text ? `HTTP ${res.status}: ${text.trim()}` : `HTTP ${res.status}`);
          debug('thirdweb client ID invalid', { status: res.status, body: text.trim() || '(empty)' });
          return;
        }

        const json = (await res.json().catch(() => null)) as null | { result?: string; error?: { message?: string } };
        if (json?.result) {
          setThirdwebClientIdStatus('valid');
          setThirdwebClientIdError(null);
          debug('thirdweb client ID valid');
          return;
        }

        setThirdwebClientIdStatus('invalid');
        setThirdwebClientIdError(json?.error?.message ?? 'Unexpected response');
        debug('thirdweb client ID invalid (unexpected response)', json);
      } catch (err) {
        if (controller.signal.aborted) return;
        setThirdwebClientIdStatus('invalid');
        setThirdwebClientIdError(err instanceof Error ? err.message : 'Network error');
        debug('thirdweb client ID validation network error', err);
      }
    };

    void validate();

    return () => controller.abort();
  }, [debug]);

  useEffect(() => {
    const init = async () => {
      const startedAt = Date.now();
      let warnTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        setWasmInitStalled(false);
        debug('initializing WASM security module…');
        warnTimer = setTimeout(() => {
          setWasmInitStalled(true);
          debug('WASM init still pending after 10s');
        }, 10_000);
        const wasmModule = await import('@xmtp/user-preferences-bindings-wasm/web');
        await wasmModule.default();
        debug('WASM security module ready');
        debug('WASM init completed', { ms: Date.now() - startedAt });
        console.log('WebAssembly module initialized successfully');
        setIsWasmInitialized(true);
      } catch (error: unknown) {
        setWasmError(error instanceof Error ? error.message : 'Unknown error');
        console.error('Error initializing WebAssembly:', error);
        debug('WASM init error', error);
        debug('WASM init failed', { ms: Date.now() - startedAt });
      } finally {
        if (warnTimer) clearTimeout(warnTimer);
      }
    };

    void init();
  }, [debug]);

  const resolveInboxAddress = useCallback(
    async (inboxId?: string) => {
      if (!inboxId) return undefined;
      const existing = inboxDetailsRef.current[inboxId];
      if (existing?.address || existing?.identifiers) return existing?.address ?? findEthereumAddress(existing.identifiers);
      try {
        const states = await Client.inboxStateFromInboxIds([inboxId], xmtpEnv);
        const state = states?.[0];
        const address = findEthereumAddress(state?.identifiers ?? state?.accountIdentifiers);
        setInboxDetails((prev) => ({
          ...prev,
          [inboxId]: {
            address,
            identifiers: (state as { identifiers?: Identifier[] })?.identifiers ?? (state as { accountIdentifiers?: Identifier[] })?.accountIdentifiers,
          },
        }));
        return address;
      } catch (err) {
        debug('failed to resolve inbox address', err);
        return undefined;
      }
    },
    [debug, xmtpEnv],
  );

  const upsertConversationSummary = useCallback((summary: ConversationSummary) => {
    setConversationsById((prev) => {
      const existing = prev[summary.conversation.id];
      return {
        ...prev,
        [summary.conversation.id]: {
          ...existing,
          ...summary,
        },
      };
    });
  }, []);

  const loadConversationPeers = useCallback(
    async (conversation: Dm) => {
      try {
        const peerInboxId = await conversation.peerInboxId();
        const peerAddress = await resolveInboxAddress(peerInboxId);
        return { peerInboxId, peerAddress };
      } catch (err) {
        debug('failed to load peer inbox', err);
        return { peerInboxId: undefined, peerAddress: undefined };
      }
    },
    [debug, resolveInboxAddress],
  );

  const loadConversations = useCallback(async () => {
    if (!xmtpClient) return;
    try {
      const convos = await xmtpClient.conversations.list({
        conversationType: ConversationType.Dm,
        consentStates: [ConsentState.Allowed],
      });

      const hydrated = await Promise.all(
        convos.map(async (conversation) => {
          const [peerInfo, lastMessage] = await Promise.all([
            loadConversationPeers(conversation as Dm),
            (conversation as Dm).lastMessage().catch(() => undefined),
          ]);
          return {
            conversation: conversation as Dm,
            lastMessage: lastMessage ?? undefined,
            peerInboxId: peerInfo.peerInboxId,
            peerAddress: peerInfo.peerAddress,
          } satisfies ConversationSummary;
        }),
      );

      setConversationsById((prev) => {
        const next = { ...prev };
        for (const summary of hydrated) {
          next[summary.conversation.id] = summary;
        }
        return next;
      });
    } catch (err) {
      debug('failed to load conversations', err);
    }
  }, [debug, loadConversationPeers, xmtpClient]);

  const addMessages = useCallback((conversationId: string, incoming: DecodedMessage | DecodedMessage[]) => {
    setMessagesByConversation((prev) => {
      const nextMessages = { ...prev };
      const existing = nextMessages[conversationId] ?? [];
      const incomingArray = Array.isArray(incoming) ? incoming : [incoming];
      const merged = [...existing];
      for (const msg of incomingArray) {
        if (merged.find((m) => m.id === msg.id)) continue;
        merged.push(msg);
      }
      merged.sort((a, b) => Number(a.sentAtNs - b.sentAtNs));
      nextMessages[conversationId] = merged;
      return nextMessages;
    });
  }, []);

  const loadMessagesForConversation = useCallback(
    async (conversation: Dm) => {
      try {
        const messages = await conversation.messages({
          direction: SortDirection.SORT_DIRECTION_ASCENDING,
        });
        addMessages(conversation.id, messages);
        const last = messages.at(-1);
        if (last) {
          upsertConversationSummary({ conversation, lastMessage: last });
        }
      } catch (err) {
        debug('failed to load messages', err);
      }
    },
    [addMessages, debug, upsertConversationSummary],
  );

  const initializeXmtpClient = useCallback(async () => {
    if (!thirdwebClient) {
      debug('XMTP init skipped: missing thirdweb client');
      return;
    }
    if (!activeWallet) {
      debug('XMTP init skipped: missing active wallet');
      return;
    }
    if (!isWasmInitialized) {
      debug('XMTP init skipped: WASM not ready');
      return;
    }
    if (xmtpClient) {
      debug('XMTP init skipped: client already initialized', { clientAddress });
      return;
    }
    if (xmtpLoading) {
      debug('XMTP init skipped: already initializing');
      return;
    }

    const startedAt = Date.now();
    let warnTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      setXmtpInitStalled(false);
      setXmtpLoading(true);
      setXmtpError(null);
      const chain = activeWallet.getChain() ?? ethereum;
      debug('XMTP init starting', { env: xmtpEnv, chainId: chain.id, chainName: chain.name });
      const eip1193Provider = EIP1193.toProvider({
        wallet: activeWallet,
        chain,
        client: thirdwebClient,
      });

      const provider = new ethers.BrowserProvider(eip1193Provider as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      warnTimer = setTimeout(() => {
        setXmtpInitStalled(true);
        debug('XMTP init still pending after 10s');
      }, 10_000);

      const xmtpSigner = {
        type: 'EOA' as const,
        getIdentifier: () => ({ identifier: address, identifierKind: IdentifierKind.Ethereum }),
        signMessage: async (message: string) => {
          const signature = await signer.signMessage(message);
          return ethers.getBytes(signature);
        },
      };

      const client = await Client.create(xmtpSigner, { env: xmtpEnv });
      setXmtpClient(client);
      debug('XMTP init resolved', { inboxId: client.inboxId, address });
      debug('XMTP init completed', { ms: Date.now() - startedAt });
      await loadConversations();
      if (client.inboxId) {
        setInboxDetails((prev) => ({ ...prev, [client.inboxId!]: { address } }));
      }
    } catch (err) {
      console.error('Error initializing XMTP client:', err);
      debug('XMTP init error', err);
      debug('XMTP init failed', { ms: Date.now() - startedAt });
      setXmtpError(err instanceof Error ? err.message : 'Failed to initialize XMTP');
    } finally {
      if (warnTimer) clearTimeout(warnTimer);
      setXmtpLoading(false);
    }
  }, [
    activeWallet,
    clientAddress,
    debug,
    isWasmInitialized,
    loadConversations,
    xmtpClient,
    xmtpEnv,
    xmtpLoading,
  ]);

  useEffect(() => {
    void initializeXmtpClient();
  }, [initializeXmtpClient]);

  useEffect(() => {
    if (selectedConversationId) return;
    const first = Object.values(conversationsById).sort((a, b) => {
      const aTime = a.lastMessage ? Number(a.lastMessage.sentAtNs) : Number(a.conversation.createdAtNs ?? 0n);
      const bTime = b.lastMessage ? Number(b.lastMessage.sentAtNs) : Number(b.conversation.createdAtNs ?? 0n);
      return bTime - aTime;
    })[0];
    if (first) setSelectedConversationId(first.conversation.id);
  }, [conversationsById, selectedConversationId]);

  useEffect(() => {
    if (!xmtpClient) {
      setConversationsById({});
      setMessagesByConversation({});
      setSelectedConversationId(null);
      return;
    }
  }, [xmtpClient]);

  useEffect(() => {
    if (!xmtpClient) return;
    void loadConversations();
  }, [loadConversations, xmtpClient]);

  useEffect(() => {
    if (!xmtpClient) return;
    let isMounted = true;

    const startStreams = async () => {
      try {
        const convoStream = await xmtpClient.conversations.streamDms({
          onValue: (dm) => {
            void loadConversationPeers(dm).then((peerInfo) => {
              if (!isMounted) return;
              upsertConversationSummary({ conversation: dm, peerAddress: peerInfo.peerAddress, peerInboxId: peerInfo.peerInboxId });
            });
          },
        });
        conversationStreamRef.current = convoStream as AsyncIterator<Dm>;

        const messageStream = await xmtpClient.conversations.streamAllMessages({
          conversationType: ConversationType.Dm,
          consentStates: [ConsentState.Allowed],
          onValue: async (message) => {
            const conversationId = message.conversationId;
            const existingConversation = conversationsById[conversationId]?.conversation;
            if (!existingConversation) {
              const fetched = await xmtpClient.conversations.getConversationById(conversationId);
              if (fetched && fetched instanceof Dm) {
                const peerInfo = await loadConversationPeers(fetched);
                upsertConversationSummary({ conversation: fetched, peerAddress: peerInfo.peerAddress, peerInboxId: peerInfo.peerInboxId, lastMessage: message });
              }
            } else {
              upsertConversationSummary({ conversation: existingConversation, lastMessage: message });
            }
            addMessages(conversationId, message);
            await resolveInboxAddress(message.senderInboxId);
          },
        });
        messageStreamRef.current = messageStream as AsyncIterator<DecodedMessage>;
      } catch (err) {
        debug('failed to start streams', err);
      }
    };

    void startStreams();

    return () => {
      isMounted = false;
      void conversationStreamRef.current?.return?.();
      void messageStreamRef.current?.return?.();
      conversationStreamRef.current = null;
      messageStreamRef.current = null;
    };
  }, [addMessages, conversationsById, debug, loadConversationPeers, resolveInboxAddress, upsertConversationSummary, xmtpClient]);

  useEffect(() => {
    const timer = xmtpLoading
      ? setTimeout(() => {
          setXmtpInitStalled(true);
        }, 10_000)
      : undefined;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [xmtpLoading]);

  const conversationList = useMemo(() => {
    const list = Object.values(conversationsById);
    const filtered = list.filter((c) => {
      const label = c.peerAddress ?? c.peerInboxId ?? c.conversation.id;
      return label.toLowerCase().includes(search.trim().toLowerCase());
    });
    return filtered.sort((a, b) => {
      const aTime = a.lastMessage ? Number(a.lastMessage.sentAtNs) : Number(a.conversation.createdAtNs ?? 0n);
      const bTime = b.lastMessage ? Number(b.lastMessage.sentAtNs) : Number(b.conversation.createdAtNs ?? 0n);
      return bTime - aTime;
    });
  }, [conversationsById, search]);

  const selectedConversation = selectedConversationId ? conversationsById[selectedConversationId]?.conversation ?? null : null;
  const selectedMessages = selectedConversationId ? messagesByConversation[selectedConversationId] ?? [] : [];

  useEffect(() => {
    if (!selectedConversation) return;
    if (messagesByConversation[selectedConversation.id]?.length) return;
    void loadMessagesForConversation(selectedConversation);
  }, [loadMessagesForConversation, messagesByConversation, selectedConversation]);

  const ensProvider = useMemo(() => {
    const rpcUrl = process.env.NEXT_PUBLIC_MAINNET_RPC_URL;
    if (rpcUrl) return new ethers.JsonRpcProvider(rpcUrl);
    return ethers.getDefaultProvider('mainnet');
  }, []);

  const resolvePeerAddress = async (peer: string) => {
    if (isHexAddress(peer)) return peer;
    const resolved = await ensProvider.resolveName(peer);
    if (!resolved) {
      throw new Error(`Could not resolve "${peer}". Try a 0x address or set NEXT_PUBLIC_MAINNET_RPC_URL.`);
    }
    return resolved;
  };

  const handleSendReply = async (options: { subject?: string; body: string }) => {
    if (!xmtpClient || !selectedConversationId) return;
    const summary = conversationsById[selectedConversationId];
    if (!summary) return;
    await summary.conversation.send(
      encodeXmtpEmailV1({
        subject: options.subject ?? '',
        body: options.body,
        from: clientAddress,
        to: summary.peerAddress ?? summary.peerInboxId ?? selectedConversationId,
      }),
    );
  };

  const handleComposeSend = async () => {
    if (!xmtpClient) return;

    setComposeIsSending(true);
    setComposeError(null);

    try {
      const parsed = parseRecipient(composeTo);
      if (parsed.kind === 'invalid') {
        setComposeError(parsed.error);
        return;
      }

      if (parsed.kind === 'smtp') {
        setComposeError('SMTP delivery is not wired up yet. Use an @xmtp.mx address or an onchain address/ENS name.');
        return;
      }

      const peerAddress = await resolvePeerAddress(parsed.peer);
      const payload = encodeXmtpEmailV1({
        subject: composeSubject.trim() || '(no subject)',
        body: composeBody,
        from: clientAddress,
        to: composeTo.trim(),
      });

      const dm = await xmtpClient.conversations.newDmWithIdentifier({
        identifier: peerAddress,
        identifierKind: IdentifierKind.Ethereum,
      });
      await dm.send(payload);
      const peerInfo = await loadConversationPeers(dm);
      upsertConversationSummary({ conversation: dm, peerAddress: peerInfo.peerAddress, peerInboxId: peerInfo.peerInboxId, lastMessage: undefined });
      await loadMessagesForConversation(dm);
      setSelectedConversationId(dm.id);

      setComposeOpen(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setComposeIsSending(false);
    }
  };

  if (wasmError) {
    return (
      <div className="min-h-dvh bg-[#f6f8fc] text-neutral-900">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="flex h-dvh items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <div className="text-xl font-semibold">Failed to initialize</div>
            <div className="mt-2 text-sm text-neutral-600">WebAssembly error: {wasmError}</div>
            <StartupStatusPanel
              xmtpEnv={xmtpEnv}
              thirdwebClient={Boolean(thirdwebClient)}
              thirdwebClientIdStatus={thirdwebClientIdStatus}
              thirdwebClientIdError={thirdwebClientIdError}
              activeAddress={activeAddress}
              hasActiveWallet={hasActiveWallet}
              isWasmInitialized={isWasmInitialized}
              wasmInitStalled={wasmInitStalled}
              wasmError={wasmError}
              isLoading={xmtpLoading}
              xmtpInitStalled={xmtpInitStalled}
              clientError={xmtpError ?? undefined}
              clientAddress={clientAddress}
              conversationsCount={conversationList.length}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!isWasmInitialized) {
    return (
      <div className="min-h-dvh bg-[#f6f8fc] text-neutral-900">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="flex h-dvh items-center justify-center px-6 text-center">
          <div>
            <div className="text-xl font-semibold">xmtp.mx</div>
            <div className="mt-2 text-sm text-neutral-600">Initializing security module…</div>
            <StartupStatusPanel
              xmtpEnv={xmtpEnv}
              thirdwebClient={Boolean(thirdwebClient)}
              thirdwebClientIdStatus={thirdwebClientIdStatus}
              thirdwebClientIdError={thirdwebClientIdError}
              activeAddress={activeAddress}
              hasActiveWallet={hasActiveWallet}
              isWasmInitialized={isWasmInitialized}
              wasmInitStalled={wasmInitStalled}
              wasmError={wasmError}
              isLoading={xmtpLoading}
              xmtpInitStalled={xmtpInitStalled}
              clientError={xmtpError ?? undefined}
              clientAddress={clientAddress}
              conversationsCount={conversationList.length}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!thirdwebClient) {
    return (
      <div className="min-h-dvh bg-[#f6f8fc] text-neutral-900">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold">xmtp.mx</h1>
          <p className="max-w-md text-sm text-neutral-600">
            Wallet connect is disabled because the thirdweb client ID is missing.
          </p>
          <StartupStatusPanel
            xmtpEnv={xmtpEnv}
            thirdwebClient={Boolean(thirdwebClient)}
            thirdwebClientIdStatus={thirdwebClientIdStatus}
            thirdwebClientIdError={thirdwebClientIdError}
            activeAddress={activeAddress}
            hasActiveWallet={hasActiveWallet}
            isWasmInitialized={isWasmInitialized}
            wasmInitStalled={wasmInitStalled}
            wasmError={wasmError}
            isLoading={xmtpLoading}
            xmtpInitStalled={xmtpInitStalled}
            clientError={xmtpError ?? undefined}
            clientAddress={clientAddress}
            conversationsCount={conversationList.length}
          />
        </div>
      </div>
    );
  }

  if (!activeAccount) {
    return (
      <div className="min-h-dvh bg-[#f6f8fc] text-neutral-900">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold">xmtp.mx</h1>
          <ConnectButton client={thirdwebClient} appMetadata={thirdwebAppMetadata} chain={ethereum} />
          {xmtpError && <p className="text-sm text-red-600">{xmtpError}</p>}
          <StartupStatusPanel
            xmtpEnv={xmtpEnv}
            thirdwebClient={Boolean(thirdwebClient)}
            thirdwebClientIdStatus={thirdwebClientIdStatus}
            thirdwebClientIdError={thirdwebClientIdError}
            activeAddress={activeAddress}
            hasActiveWallet={hasActiveWallet}
            isWasmInitialized={isWasmInitialized}
            wasmInitStalled={wasmInitStalled}
            wasmError={wasmError}
            isLoading={xmtpLoading}
            xmtpInitStalled={xmtpInitStalled}
            clientError={xmtpError ?? undefined}
            clientAddress={clientAddress}
            conversationsCount={conversationList.length}
          />
        </div>
      </div>
    );
  }

  if (!xmtpClient) {
    return (
      <div className="min-h-dvh bg-[#f6f8fc] text-neutral-900">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold">xmtp.mx</h1>
          <p className="text-sm text-neutral-600">
            {!activeWallet ? 'Waiting for wallet provider…' : xmtpLoading ? 'Initializing XMTP…' : xmtpError ? 'XMTP failed.' : 'Initializing XMTP…'}
          </p>
          {xmtpError ? <p className="max-w-md text-sm text-red-600">{xmtpError}</p> : null}
          {xmtpError ? (
            <button
              type="button"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void initializeXmtpClient()}
              disabled={!activeWallet || !isWasmInitialized || xmtpLoading}
            >
              Try again
            </button>
          ) : null}
          <StartupStatusPanel
            xmtpEnv={xmtpEnv}
            thirdwebClient={Boolean(thirdwebClient)}
            thirdwebClientIdStatus={thirdwebClientIdStatus}
            thirdwebClientIdError={thirdwebClientIdError}
            activeAddress={activeAddress}
            hasActiveWallet={hasActiveWallet}
            isWasmInitialized={isWasmInitialized}
            wasmInitStalled={wasmInitStalled}
            wasmError={wasmError}
            isLoading={xmtpLoading}
            xmtpInitStalled={xmtpInitStalled}
            clientError={xmtpError ?? undefined}
            clientAddress={clientAddress}
            conversationsCount={conversationList.length}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#f6f8fc] text-neutral-900">
      <div className="flex h-full flex-col">
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <header className="border-b bg-[#f6f8fc] px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-blue-600" />
              <div className="text-lg font-semibold tracking-tight">xmtp.mx</div>
            </div>

            <div className="ml-3 hidden flex-1 sm:block">
              <input
                className="w-full rounded-full border bg-white px-4 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                placeholder="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
              />
            </div>

            <div className="ml-auto">
              <ConnectButton client={thirdwebClient} appMetadata={thirdwebAppMetadata} chain={ethereum} />
            </div>
          </div>
        </header>

        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <aside className="hidden w-[256px] shrink-0 sm:flex sm:flex-col">
            <button
              type="button"
              className="mb-4 inline-flex items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              onClick={() => setComposeOpen(true)}
            >
              Compose
            </button>

            <nav className="space-y-1">
              <div className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm ring-1 ring-black/5">
                Inbox
              </div>
              <div className="rounded-xl px-3 py-2 text-sm text-neutral-600">Sent</div>
              <div className="rounded-xl px-3 py-2 text-sm text-neutral-600">Drafts</div>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
            <section className="w-[360px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-neutral-900">Inbox</div>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 sm:hidden"
                    onClick={() => setComposeOpen(true)}
                  >
                    Compose
                  </button>
                </div>
                <div className="mt-2 sm:hidden">
                  <input
                    className="w-full rounded-full border bg-white px-4 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                    placeholder="Search"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                  />
                </div>
              </div>
              <div className="h-full overflow-y-auto">
                {conversationList.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-neutral-500">No conversations.</div>
                ) : (
                  conversationList.map((summary) => {
                    const lastMessage = summary.lastMessage;
                    const lastMessageDate = lastMessage ? nsToDate(lastMessage.sentAtNs) : undefined;
                    const label = summary.peerAddress ?? summary.peerInboxId ?? summary.conversation.id;

                    return (
                      <button
                        key={summary.conversation.id}
                        type="button"
                        className={[
                          'w-full border-b px-4 py-3 text-left hover:bg-neutral-50',
                          selectedConversationId === summary.conversation.id ? 'bg-neutral-50' : '',
                        ].join(' ')}
                        onClick={() => {
                          setSelectedConversationId(summary.conversation.id);
                          void loadMessagesForConversation(summary.conversation);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-semibold text-neutral-900">{label}</div>
                          <div className="shrink-0 text-xs text-neutral-500">{formatTimestamp(lastMessageDate)}</div>
                        </div>
                        <div className="mt-1 truncate text-xs text-neutral-500">
                          {lastMessage ? decodeXmtpEmail(lastMessage.content).kind === 'email'
                            ? decodeXmtpEmail(lastMessage.content).email.subject || '(no subject)'
                            : decodeXmtpEmail(lastMessage.content).text
                            : 'No messages yet.'}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="min-w-0 flex-1 overflow-hidden">
              {selectedConversation ? (
                <Thread
                  conversation={selectedConversation}
                  messages={selectedMessages}
                  selfInboxId={xmtpClient.inboxId}
                  inboxDetails={inboxDetails}
                  onReply={(options) => handleSendReply(options)}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                  <div className="text-sm text-neutral-500">Select a conversation to read messages.</div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="text-sm font-semibold text-neutral-900">New message</div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
                onClick={() => {
                  setComposeOpen(false);
                  setComposeError(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {composeError ? <div className="text-sm text-red-600">{composeError}</div> : null}

              <div>
                <label className="block text-xs font-semibold text-neutral-600">To</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  placeholder="deanpierce.eth@xmtp.mx"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.currentTarget.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600">Subject</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  placeholder="(no subject)"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.currentTarget.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600">Message</label>
                <textarea
                  className="mt-1 min-h-[160px] w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  placeholder="Write your message…"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                onClick={() => setComposeOpen(false)}
                disabled={composeIsSending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void handleComposeSend()}
                disabled={composeIsSending || !composeTo.trim()}
              >
                {composeIsSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default XMTPWebmailClient;
