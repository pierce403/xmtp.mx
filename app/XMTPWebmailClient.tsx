'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client, ConsentState, ConversationType, DecodedMessage, Dm, SortDirection } from '@xmtp/browser-sdk';
import type { Identifier, IdentifierKind } from '@xmtp/browser-sdk';
import { ethers } from 'ethers';
import { useActiveAccount, useActiveWallet, ConnectButton } from 'thirdweb/react';
import { EIP1193 } from 'thirdweb/wallets';
import { ethereum } from 'thirdweb/chains';
import { THIRDWEB_CLIENT_ID, thirdwebAppMetadata, thirdwebClient } from '@/lib/thirdwebClient';
import { decodeXmtpEmail, encodeXmtpEmailV1 } from '@/lib/xmtpEmail';
import { isHexAddress, parseRecipient, shortenAddress } from '@/lib/xmtpAddressing';
import { ThemeToggle } from './ThemeContext';

type ThirdwebClientIdStatus = 'missing' | 'checking' | 'valid' | 'invalid';

type StartupStatusTone = 'ok' | 'pending' | 'error' | 'neutral';

const WELCOME_CONVERSATION_ID = 'welcome-thread';

type InboxDetailsMap = Record<string, { address?: string; identifiers?: Identifier[] }>;

type XmtpConversationSummary = {
  kind: 'xmtp';
  id: string;
  conversation: Dm;
  peerInboxId?: string;
  peerAddress?: string;
  lastMessage?: DecodedMessage;
};

type WelcomeConversationSummary = {
  kind: 'welcome';
  id: typeof WELCOME_CONVERSATION_ID;
  subject: string;
  preview: string;
  body: string;
  timestamp: Date;
};

type ConversationListItem = XmtpConversationSummary | WelcomeConversationSummary;

const WELCOME_MESSAGE: Omit<WelcomeConversationSummary, 'kind' | 'id'> = {
  subject: 'Welcome to xmtp.mx',
  preview: 'Here’s what this XMTP inbox does and how to try it out.',
  body:
    'Hi there,\n\nThanks for opening xmtp.mx — a Gmail-inspired inbox that speaks the XMTP messaging network.\n\nWhen you connect a wallet, we generate an XMTP identity tied to your address and render conversations like email threads. Messages are encrypted end-to-end and stay on XMTP; there is no central inbox server here.\n\nYou can send to onchain addresses or ENS names (e.g. deanpierce.eth). SMTP delivery is on the roadmap, but today you’ll want to message XMTP peers.\n\nIf something looks off, try refreshing after connecting your wallet or double-checking your thirdweb client ID.\n\nHave fun, and thanks for testing!',
  timestamp: new Date(),
};

const ETHEREUM_IDENTIFIER_KIND: IdentifierKind = 'Ethereum';

// ===== DEMO MODE MOCK DATA =====
type DemoMessage = {
  id: string;
  senderInboxId: string;
  content: string;
  sentAt: Date;
  isEmail: boolean;
  subject?: string;
};

type DemoConversation = {
  id: string;
  peerAddress: string;
  peerName?: string;
  messages: DemoMessage[];
  lastMessageAt: Date;
};

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: 'demo-1',
    peerAddress: '0x1234...abcd',
    peerName: 'vitalik.eth',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 30),
    messages: [
      { id: 'msg-1-1', senderInboxId: 'peer', content: 'Hey! Just saw your project. The XMTP integration looks great!', sentAt: new Date(Date.now() - 1000 * 60 * 60 * 2), isEmail: false },
      { id: 'msg-1-2', senderInboxId: 'self', content: 'Thanks! We are trying to make encrypted messaging feel like email.', sentAt: new Date(Date.now() - 1000 * 60 * 60), isEmail: false },
      { id: 'msg-1-3', senderInboxId: 'peer', content: 'Love the Gmail-inspired design. The dark mode is slick!', sentAt: new Date(Date.now() - 1000 * 60 * 30), isEmail: false },
    ],
  },
  {
    id: 'demo-2',
    peerAddress: '0x5678...efgh',
    peerName: 'deanpierce.eth',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
    messages: [
      { id: 'msg-2-1', senderInboxId: 'peer', sentAt: new Date(Date.now() - 1000 * 60 * 60 * 5), isEmail: true, subject: 'Re: XMTP Bridge Progress', content: 'The SMTP bridge is coming along nicely.\n\nLet me know if you have any questions!' },
      { id: 'msg-2-2', senderInboxId: 'self', sentAt: new Date(Date.now() - 1000 * 60 * 60 * 3), isEmail: true, subject: 'Re: XMTP Bridge Progress', content: 'That is awesome! The email-style threading is working well.' },
    ],
  },
  {
    id: 'demo-3',
    peerAddress: '0x9abc...ijkl',
    peerName: 'alice.eth',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    messages: [
      { id: 'msg-3-1', senderInboxId: 'self', sentAt: new Date(Date.now() - 1000 * 60 * 60 * 25), isEmail: false, content: 'Hey Alice, have you tried the new theme toggle?' },
      { id: 'msg-3-2', senderInboxId: 'peer', sentAt: new Date(Date.now() - 1000 * 60 * 60 * 24), isEmail: false, content: 'Yes! The dark mode is beautiful. The glassmorphism effects are really nice too.' },
    ],
  },
];

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
  const eth = identifiers.find((id) => id.identifierKind === ETHEREUM_IDENTIFIER_KIND);
  return eth?.identifier;
}

function extractIdentifiers(
  state?: { identifiers?: Identifier[] } | { accountIdentifiers?: Identifier[] },
): Identifier[] | undefined {
  if (!state) return undefined;
  if ('identifiers' in state && state.identifiers) return state.identifiers;
  if ('accountIdentifiers' in state) return state.accountIdentifiers;
  return undefined;
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
  threadTitle?: string;
  threadSubtitle?: string;
};

function Thread({ conversation, messages, selfInboxId, inboxDetails, onReply, threadTitle, threadSubtitle }: ThreadProps) {
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
    <div className="flex h-full flex-col overflow-hidden rounded-3xl backdrop-blur-md" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-xl)', border: '1px solid var(--border-subtle)' }}>
      <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{threadTitle ?? shortenInboxId(conversation.id)}</div>
        <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{threadSubtitle ?? 'XMTP thread'}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--foreground-muted)' }}>No messages yet.</div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isSelf = selfInboxId ? message.senderInboxId === selfInboxId : false;
              const decoded = decodeXmtpEmail(message.content);
              const sentAt = nsToDate(message.sentAtNs);

              return (
                <div key={message.id} className={['flex', isSelf ? 'justify-end' : 'justify-start'].join(' ')}>
                  <div
                    className="max-w-[720px] rounded-2xl px-4 py-3 backdrop-blur"
                    style={{
                      background: isSelf ? 'var(--primary-subtle)' : 'var(--surface)',
                      border: isSelf ? '1px solid var(--primary)' : '1px solid var(--border)',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                      <div className="truncate">{isSelf ? 'You' : senderLabel(message.senderInboxId)}</div>
                      <div className="shrink-0">{formatTimestamp(sentAt)}</div>
                    </div>

                    {decoded.kind === 'email' ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                          {decoded.email.subject || '(no subject)'}
                        </div>
                        <div className="whitespace-pre-wrap text-sm" style={{ color: 'var(--foreground)' }}>{decoded.email.body}</div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm" style={{ color: 'var(--foreground)' }}>{decoded.text}</div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
        {sendError ? <div className="mb-2 text-xs" style={{ color: 'var(--accent-error)' }}>{sendError}</div> : null}
        <div className="flex gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-2xl px-3 py-2 text-sm outline-none transition"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--foreground)', boxShadow: 'var(--shadow-inner)' }}
            placeholder="Reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.currentTarget.value)}
          />
          <button
            type="button"
            className="h-[44px] shrink-0 rounded-2xl px-4 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-md)' }}
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

function WelcomeThread({ conversation }: { conversation: WelcomeConversationSummary }) {
  const paragraphs = useMemo(() => conversation.body.split('\n\n'), [conversation.body]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl backdrop-blur-md" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-xl)', border: '1px solid var(--border-subtle)' }}>
      <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{conversation.subject}</div>
        <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>From XMTP Mailroom • {formatTimestamp(conversation.timestamp)}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--welcome-bg)', color: 'var(--welcome-fg)', border: '1px solid var(--welcome-border)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--welcome-accent)' }} />
          Local welcome email (for your eyes only)
        </div>

        <div className="space-y-4 text-sm" style={{ color: 'var(--foreground)' }}>
          {paragraphs.map((para, idx) => (
            <p key={idx} className="leading-relaxed">
              {para}
            </p>
          ))}

          <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--primary-subtle)', border: '1px solid var(--primary)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Quick start</div>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]" style={{ color: 'var(--foreground-muted)' }}>
              <li>Connect your wallet with the button above. We’ll show your XMTP inbox instantly.</li>
              <li>Hit Compose to message an ENS name or 0x address. We style threads like email, but they stay on XMTP.</li>
              <li>Replies are encrypted end-to-end. There’s no central mail server in the middle.</li>
            </ul>
          </div>
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
  const [conversationsById, setConversationsById] = useState<Record<string, XmtpConversationSummary>>({});
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

  // Demo mode: bypass auth and show full UI with mock data - enable with ?demo in URL
  const [demoMode, setDemoMode] = useState(false);
  const [demoSelectedId, setDemoSelectedId] = useState<string | null>('welcome-thread');
  const [demoView, setDemoView] = useState<'inbox' | 'sent' | 'contacts'>('inbox');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('demo')) {
        setDemoMode(true);
      }
    }
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && demoSelectedId) {
        setDemoSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [demoSelectedId]);


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
    if (identifier?.identifierKind === ETHEREUM_IDENTIFIER_KIND) return identifier.identifier;
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
        const identifiers = extractIdentifiers(state);
        const address = findEthereumAddress(identifiers);
        setInboxDetails((prev) => ({
          ...prev,
          [inboxId]: {
            address,
            identifiers,
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

  const upsertConversationSummary = useCallback((summary: Omit<XmtpConversationSummary, 'id' | 'kind'>) => {
    setConversationsById((prev) => {
      const id = summary.conversation.id;
      const existing = prev[id];
      const restExisting = existing
        ? (() => {
          const clone = { ...existing } as Partial<XmtpConversationSummary>;
          delete clone.kind;
          delete clone.id;
          return clone;
        })()
        : {};
      return {
        ...prev,
        [id]: {
          kind: 'xmtp',
          id,
          ...restExisting,
          ...summary,
        },
      } satisfies Record<string, XmtpConversationSummary>;
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
            kind: 'xmtp' as const,
            id: conversation.id,
            conversation: conversation as Dm,
            lastMessage: lastMessage ?? undefined,
            peerInboxId: peerInfo.peerInboxId,
            peerAddress: peerInfo.peerAddress,
          } satisfies XmtpConversationSummary;
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
          direction: SortDirection.Ascending,
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
        getIdentifier: () => ({ identifier: address, identifierKind: ETHEREUM_IDENTIFIER_KIND }),
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

  const welcomeConversation = useMemo<WelcomeConversationSummary>(
    () => ({ kind: 'welcome', id: WELCOME_CONVERSATION_ID, ...WELCOME_MESSAGE }),
    [],
  );

  const xmtpConversationList = useMemo<XmtpConversationSummary[]>(() => {
    const trimmed = search.trim().toLowerCase();
    const list = Object.values(conversationsById);
    const filtered = list.filter((c) => {
      const label = c.peerAddress ?? c.peerInboxId ?? c.conversation.id;
      if (!trimmed) return true;
      return label.toLowerCase().includes(trimmed);
    });
    return filtered.sort((a, b) => {
      const aTime = a.lastMessage ? Number(a.lastMessage.sentAtNs) : Number(a.conversation.createdAtNs ?? 0n);
      const bTime = b.lastMessage ? Number(b.lastMessage.sentAtNs) : Number(b.conversation.createdAtNs ?? 0n);
      return bTime - aTime;
    });
  }, [conversationsById, search]);

  const conversationList = useMemo<ConversationListItem[]>(() => {
    const trimmed = search.trim().toLowerCase();
    const matchesWelcome =
      !trimmed ||
      welcomeConversation.subject.toLowerCase().includes(trimmed) ||
      welcomeConversation.preview.toLowerCase().includes(trimmed) ||
      welcomeConversation.body.toLowerCase().includes(trimmed);

    const withWelcome: ConversationListItem[] = matchesWelcome ? [welcomeConversation, ...xmtpConversationList] : xmtpConversationList;
    return withWelcome;
  }, [search, welcomeConversation, xmtpConversationList]);

  useEffect(() => {
    if (!conversationList.length) {
      setSelectedConversationId(null);
      return;
    }

    if (!selectedConversationId) {
      setSelectedConversationId(conversationList[0]?.id ?? null);
      return;
    }

    const stillExists = conversationList.some((item) => item.id === selectedConversationId);
    if (!stillExists) {
      setSelectedConversationId(conversationList[0]?.id ?? null);
    }
  }, [conversationList, selectedConversationId]);

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return conversationList.find((item) => item.id === selectedConversationId) ?? null;
  }, [conversationList, selectedConversationId]);

  const selectedMessages = selectedConversation?.kind === 'xmtp' ? messagesByConversation[selectedConversation.id] ?? [] : [];

  useEffect(() => {
    if (!selectedConversation || selectedConversation.kind !== 'xmtp') return;
    if (messagesByConversation[selectedConversation.id]?.length) return;
    void loadMessagesForConversation(selectedConversation.conversation);
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
    if (!xmtpClient) return;
    if (!selectedConversation || selectedConversation.kind !== 'xmtp') return;
    await selectedConversation.conversation.send(
      encodeXmtpEmailV1({
        subject: options.subject ?? '',
        body: options.body,
        from: clientAddress,
        to: selectedConversation.peerAddress ?? selectedConversation.peerInboxId ?? selectedConversation.id,
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
        identifierKind: ETHEREUM_IDENTIFIER_KIND,
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

  // ===== DEMO MODE RENDER =====
  if (demoMode) {
    const welcomeConvo: WelcomeConversationSummary = { kind: 'welcome', id: WELCOME_CONVERSATION_ID, ...WELCOME_MESSAGE };
    const selectedDemo = demoSelectedId === WELCOME_CONVERSATION_ID
      ? welcomeConvo
      : DEMO_CONVERSATIONS.find(c => c.id === demoSelectedId);
    const lastSyncTime = new Date(Date.now() - 1000 * 60 * 2); // 2 mins ago for demo

    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)' }}>
        <div className="mx-auto flex h-dvh max-w-6xl flex-col gap-4 p-4">
          {/* Header */}
          <header className="header-glass flex items-center justify-between px-5 animate-fade-in" style={{ borderRadius: 'var(--radius-xl)', height: 'var(--header-height)' }}>
            {/* Left: Logo + Title */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl text-lg glow-sm" style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-glow-sm)' }}>
                ✉️
              </div>
              <div>
                <div className="text-base font-bold gradient-text">xmtp.mx</div>
                <div className="text-[10px] flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-success)', boxShadow: '0 0 6px var(--accent-success)' }}></span>
                  Synced {formatTimestamp(lastSyncTime)}
                </div>
              </div>
              <div className="ml-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: 'var(--gradient-accent)', color: 'white', boxShadow: 'var(--shadow-glow-sm)' }}>
                Demo
              </div>
            </div>

            {/* Right: Theme Toggle + Settings + Identity */}
            <div className="flex items-center gap-3">
              {/* Theme Toggle - More Prominent */}
              <div className="rounded-xl p-1.5 card-shiny" style={{ background: 'var(--surface-glass)' }}>
                <ThemeToggle />
              </div>

              {/* Settings */}
              <button
                type="button"
                className="rounded-xl p-2.5 transition-all hover:scale-105"
                style={{ color: 'var(--foreground-muted)', background: 'var(--surface-glass)', border: '1px solid var(--border)' }}
                title="Settings"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* Divider */}
              <div className="h-7 w-px rounded-full" style={{ background: 'var(--border)' }}></div>

              {/* Identity / Profile */}
              <button type="button" className="flex items-center gap-3 rounded-xl px-3 py-2 transition-all hover:scale-[1.02]" style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)' }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-glow-sm)' }}>
                  DP
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>demo.eth</div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--foreground-muted)' }}>0x71C7...1F3a</div>
                </div>
                <svg className="h-4 w-4 hidden sm:block" style={{ color: 'var(--foreground-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </header>

          {/* Main Content */}
          <div className="flex flex-1 gap-4 overflow-hidden">
            {/* Sidebar */}
            <aside className="flex w-[180px] shrink-0 flex-col animate-fade-in delay-1">
              <div className="sidebar-glass" style={{ borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)' }}>
                <nav className="flex flex-col gap-2">
                  {/* Compose */}
                  <button
                    type="button"
                    className="btn-primary flex items-center justify-center gap-2"
                    style={{
                      height: '44px',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-base)',
                      fontWeight: 600
                    }}
                    onClick={() => setComposeOpen(true)}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M12 4v16m8-8H4" />
                    </svg>
                    Compose
                  </button>

                  <div className="my-2 h-px" style={{ background: 'var(--border)' }}></div>

                  {/* Inbox */}
                  <button
                    onClick={() => setDemoView('inbox')}
                    className="flex items-center gap-3 transition-all hover:translate-x-1"
                    style={{
                      height: '42px',
                      padding: '0 var(--space-3)',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-base)',
                      fontWeight: 500,
                      color: demoView === 'inbox' ? 'var(--foreground)' : 'var(--foreground-muted)',
                      background: demoView === 'inbox' ? 'var(--primary-subtle)' : 'transparent',
                      border: demoView === 'inbox' ? '1px solid var(--primary)' : '1px solid transparent',
                      boxShadow: demoView === 'inbox' ? 'var(--shadow-glow-sm)' : 'none'
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z" />
                      <path d="M22 6l-10 7L2 6" />
                    </svg>
                    Inbox
                    <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--gradient-accent)', color: 'white' }}>{DEMO_CONVERSATIONS.length + 1}</span>
                  </button>
                  {/* Sent */}
                  <button
                    onClick={() => setDemoView('sent')}
                    className="flex items-center gap-3 transition-all hover:translate-x-1"
                    style={{
                      height: '42px',
                      padding: '0 var(--space-3)',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-base)',
                      fontWeight: 500,
                      color: demoView === 'sent' ? 'var(--foreground)' : 'var(--foreground-muted)',
                      background: demoView === 'sent' ? 'var(--primary-subtle)' : 'transparent',
                      border: demoView === 'sent' ? '1px solid var(--primary)' : '1px solid transparent',
                      boxShadow: demoView === 'sent' ? 'var(--shadow-glow-sm)' : 'none'
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Sent
                  </button>
                  {/* Contacts */}
                  <button
                    onClick={() => setDemoView('contacts')}
                    className="flex items-center gap-3 transition-all hover:translate-x-1"
                    style={{
                      height: '42px',
                      padding: '0 var(--space-3)',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-base)',
                      fontWeight: 500,
                      color: demoView === 'contacts' ? 'var(--foreground)' : 'var(--foreground-muted)',
                      background: demoView === 'contacts' ? 'var(--primary-subtle)' : 'transparent',
                      border: demoView === 'contacts' ? '1px solid var(--primary)' : '1px solid transparent',
                      boxShadow: demoView === 'contacts' ? 'var(--shadow-glow-sm)' : 'none'
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Contacts
                  </button>
                </nav>
              </div>
            </aside>

            {/* Mail List */}
            <div className="flex min-w-0 flex-1 overflow-hidden card-shiny animate-fade-in delay-2" style={{ borderRadius: 'var(--radius-xl)' }}>
              {demoView === 'contacts' ? (
                /* Contacts View */
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="mb-6">
                    <h2 className="text-xl font-bold gradient-text">Contacts</h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>People you&apos;ve messaged</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {DEMO_CONVERSATIONS.map((c, idx) => (
                      <div
                        key={c.id}
                        className="card-shiny flex items-center gap-4 p-4 cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg animate-slide-up"
                        style={{ borderRadius: 'var(--radius-xl)', animationDelay: `${idx * 50}ms` }}
                        onClick={() => { setDemoView('inbox'); setDemoSelectedId(c.id); }}
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ background: 'var(--gradient-accent)', color: 'white', boxShadow: 'var(--shadow-glow-sm)' }}>
                          {(c.peerName || c.peerAddress).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold" style={{ color: 'var(--foreground)' }}>{c.peerName || 'Unknown'}</div>
                          <div className="truncate text-xs font-mono mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{c.peerAddress}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : demoView === 'sent' ? (
                /* Sent View */
                <div className="flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between px-5 py-4 glass-strong" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="text-base font-bold gradient-text">Sent</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>Messages you&apos;ve sent</div>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    {DEMO_CONVERSATIONS.map((c) => {
                      const sentMsgs = c.messages.filter(m => m.senderInboxId === 'self');
                      return sentMsgs.map((msg, idx) => (
                        <div
                          key={msg.id}
                          className="card-shiny p-4 cursor-pointer transition-all hover:scale-[1.01] animate-slide-up"
                          style={{ borderRadius: 'var(--radius-xl)', animationDelay: `${idx * 50}ms` }}
                          onClick={() => { setDemoView('inbox'); setDemoSelectedId(c.id); }}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                            <span>To: <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{c.peerName || c.peerAddress}</span></span>
                            <span className="font-mono">{formatTimestamp(msg.sentAt)}</span>
                          </div>
                          {msg.subject && <div className="mt-2 text-sm font-bold" style={{ color: 'var(--foreground)' }}>{msg.subject}</div>}
                          <div className="mt-2 text-sm truncate" style={{ color: 'var(--foreground-muted)' }}>{msg.content}</div>
                        </div>
                      ));
                    })}
                  </div>
                </div>
              ) : (
                /* Inbox View */
                <div className="flex-1 overflow-y-auto">
                  {/* Search + Header */}
                  <div className="flex items-center justify-between px-5 py-4 glass-strong" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="text-base font-bold gradient-text">Inbox</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{DEMO_CONVERSATIONS.length + 1} messages</div>
                    </div>
                    <div className="relative">
                      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--foreground-subtle)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        className="input w-64 text-sm pl-10"
                        placeholder="Search messages..."
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                      />
                    </div>
                  </div>
                  {/* Message Rows */}
                  <div>
                    {/* Welcome row */}
                    {(!search || 'welcome xmtp team'.includes(search.toLowerCase())) && (
                      <button
                        type="button"
                        className="inbox-row flex w-full items-center gap-4 px-5 py-4 text-left animate-fade-in"
                        onClick={() => setDemoSelectedId(WELCOME_CONVERSATION_ID)}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: 'var(--gradient-accent)', color: 'white', boxShadow: 'var(--shadow-glow-sm)' }}>
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                        </div>
                        <div className="w-32 shrink-0 truncate font-bold text-sm" style={{ color: 'var(--foreground)' }}>XMTP Team</div>
                        <div className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--foreground-muted)' }}>Welcome to xmtp.mx — Your decentralized inbox</div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: 'var(--accent-success-subtle)', color: 'var(--accent-success)' }}>New</span>
                          <span className="text-xs font-mono" style={{ color: 'var(--foreground-subtle)' }}>Now</span>
                        </div>
                      </button>
                    )}
                    {/* Conversations */}
                    {DEMO_CONVERSATIONS
                      .filter(convo => {
                        if (!search) return true;
                        const q = search.toLowerCase();
                        return (convo.peerName?.toLowerCase().includes(q) ||
                          convo.peerAddress.toLowerCase().includes(q) ||
                          convo.messages.some(m => m.content.toLowerCase().includes(q)));
                      })
                      .map((convo, idx) => {
                        const lastMsg = convo.messages[convo.messages.length - 1];
                        const subject = lastMsg?.isEmail && lastMsg.subject ? lastMsg.subject : lastMsg?.content.slice(0, 60);
                        return (
                          <button
                            type="button"
                            key={convo.id}
                            className="inbox-row flex w-full items-center gap-4 px-5 py-4 text-left animate-fade-in"
                            style={{ animationDelay: `${(idx + 1) * 50}ms` }}
                            onClick={() => setDemoSelectedId(convo.id)}
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-transform hover:scale-110" style={{ background: 'var(--surface)', color: 'var(--foreground-muted)', border: '2px solid var(--border)' }}>
                              {(convo.peerName || convo.peerAddress).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="w-32 shrink-0 truncate font-bold text-sm" style={{ color: 'var(--foreground)' }}>{convo.peerName || convo.peerAddress}</div>
                            <div className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--foreground-muted)' }}>{subject}</div>
                            <div className="text-xs font-mono shrink-0" style={{ color: 'var(--foreground-subtle)' }}>{formatTimestamp(convo.lastMessageAt)}</div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Thread Modal Overlay */}
            {demoSelectedId && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in"
                style={{ background: 'var(--overlay)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
                onClick={() => setDemoSelectedId(null)}
              >
                <div
                  className="modal-glass w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scale-in"
                  style={{ borderRadius: 'var(--radius-2xl)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {selectedDemo && 'kind' in selectedDemo && selectedDemo.kind === 'welcome' ? (
                    <WelcomeThread conversation={selectedDemo} />
                  ) : selectedDemo && !('kind' in selectedDemo) ? (
                    <>
                      {/* Modal Header */}
                      <div className="flex items-center justify-between px-6 py-4 glass-strong" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ background: 'var(--gradient-accent)', color: 'white', boxShadow: 'var(--shadow-glow-sm)' }}>
                            {(selectedDemo.peerName || selectedDemo.peerAddress).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>{selectedDemo.peerName || selectedDemo.peerAddress}</div>
                            <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              <span className="flex items-center gap-1">
                                <svg className="h-3.5 w-3.5" style={{ color: 'var(--accent-success)' }} fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
                                </svg>
                                End-to-end encrypted
                              </span>
                              <span>•</span>
                              <span>{selectedDemo.messages.length} messages</span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-xl p-2.5 transition-all hover:scale-110"
                          style={{ color: 'var(--foreground-muted)', background: 'var(--surface-glass)', border: '1px solid var(--border)' }}
                          onClick={() => setDemoSelectedId(null)}
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {/* Modal Body - Messages */}
                      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: 'var(--background-subtle)' }}>
                        <div className="space-y-4">
                          {selectedDemo.messages.map((msg, idx) => {
                            const isSelf = msg.senderInboxId === 'self';
                            return (
                              <div key={msg.id} className={`flex animate-slide-up ${isSelf ? 'justify-end' : 'justify-start'}`} style={{ animationDelay: `${idx * 50}ms` }}>
                                <div
                                  className="card-shiny max-w-[420px] px-5 py-4"
                                  style={{
                                    background: isSelf ? 'var(--gradient-accent)' : 'var(--surface)',
                                    border: isSelf ? 'none' : '1px solid var(--border)',
                                    borderRadius: isSelf ? 'var(--radius-xl) var(--radius-xl) var(--radius-sm) var(--radius-xl)' : 'var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-sm)',
                                    boxShadow: isSelf ? 'var(--shadow-glow-sm)' : 'var(--shadow-md)'
                                  }}
                                >
                                  <div className="mb-2 flex items-center justify-between gap-4 text-xs" style={{ color: isSelf ? 'rgba(255,255,255,0.8)' : 'var(--foreground-muted)' }}>
                                    <div className="font-bold">{isSelf ? 'You' : (selectedDemo.peerName || 'Peer')}</div>
                                    <div className="font-mono">{formatTimestamp(msg.sentAt)}</div>
                                  </div>
                                  {msg.isEmail && msg.subject && (
                                    <div className="mb-2 text-sm font-bold" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{msg.subject}</div>
                                  )}
                                  <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{msg.content}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Modal Footer - Reply */}
                      <div className="px-6 py-4 glass-strong" style={{ borderTop: '1px solid var(--border)' }}>
                        <div className="flex gap-3">
                          <input
                            className="input flex-1 text-sm"
                            placeholder="Reply... (demo mode)"
                            disabled
                            style={{ height: '44px' }}
                          />
                          <button
                            type="button"
                            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:transform-none"
                            style={{ height: '44px', paddingLeft: '1.25rem', paddingRight: '1.25rem' }}
                            disabled
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            Send
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }


  if (wasmError) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <div className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Failed to initialize</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--foreground-muted)' }}>WebAssembly error: {wasmError}</div>
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
              conversationsCount={xmtpConversationList.length}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!isWasmInitialized) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh items-center justify-center px-6 text-center">
          <div>
            <div className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>xmtp.mx</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--foreground-muted)' }}>Initializing security module…</div>
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
              conversationsCount={xmtpConversationList.length}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!thirdwebClient) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>xmtp.mx</h1>
          <p className="max-w-md text-sm" style={{ color: 'var(--foreground-muted)' }}>
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
            conversationsCount={xmtpConversationList.length}
          />
        </div>
      </div>
    );
  }

  if (!activeAccount) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>xmtp.mx</h1>
          <ConnectButton client={thirdwebClient} appMetadata={thirdwebAppMetadata} chain={ethereum} autoConnect={false} />
          {xmtpError && <p className="text-sm" style={{ color: 'var(--accent-error)' }}>{xmtpError}</p>}
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
            conversationsCount={xmtpConversationList.length}
          />
        </div>
      </div>
    );
  }

  if (!xmtpClient) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>xmtp.mx</h1>
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {!activeWallet ? 'Waiting for wallet provider…' : xmtpLoading ? 'Initializing XMTP…' : xmtpError ? 'XMTP failed.' : 'Initializing XMTP…'}
          </p>
          {xmtpError ? <p className="max-w-md text-sm" style={{ color: 'var(--accent-error)' }}>{xmtpError}</p> : null}
          {xmtpError ? (
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-md)' }}
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
            conversationsCount={xmtpConversationList.length}
          />
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]" style={{ background: 'var(--gradient-page)' }}>
      <ThirdwebClientIdBanner status={thirdwebClientIdStatus} error={thirdwebClientIdError} />
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 pb-6 pt-4 lg:px-8">
        <header className="flex flex-col gap-3 rounded-3xl px-5 py-4 shadow-xl sm:flex-row sm:items-center sm:justify-between backdrop-blur-md" style={{ background: 'var(--header-bg)', boxShadow: 'var(--shadow-xl)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-md" style={{ background: 'var(--gradient-accent)' }}>
              XM
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>xmtp.mx Mail</div>
              <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>Gmail-inspired inbox for XMTP</div>
            </div>
          </div>

          <div className="flex w-full flex-1 items-center gap-3 sm:w-auto">
            <div className="hidden flex-1 sm:block">
              <input
                className="w-full rounded-full px-4 py-2 text-sm outline-none transition"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--foreground)',
                  boxShadow: 'var(--shadow-inner)'
                }}
                placeholder="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                onFocus={(e) => e.currentTarget.style.borderColor = 'var(--border-focus)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'var(--input-border)'}
              />
            </div>
            <div className="flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: 'var(--surface)', color: 'var(--foreground-muted)', border: '1px solid var(--border-subtle)' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-online)' }} /> XMTP {xmtpEnv}
            </div>
            <ThemeToggle />
            <ConnectButton client={thirdwebClient} appMetadata={thirdwebAppMetadata} chain={ethereum} autoConnect={false} />
          </div>
        </header>


        <div className="flex flex-1 gap-4 overflow-hidden">
          <aside className="hidden w-[260px] shrink-0 flex-col gap-3 sm:flex">
            <div className="rounded-3xl p-4 backdrop-blur-md" style={{ background: 'var(--sidebar-bg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
                style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-lg)' }}
                onClick={() => setComposeOpen(true)}
              >
                <span className="text-base">✉️</span> Compose
              </button>

              <div className="mt-4 space-y-1 text-sm font-semibold">
                <div className="flex items-center justify-between rounded-2xl px-3 py-2 transition cursor-pointer hover:scale-[1.01]" style={{ color: 'var(--foreground)', background: 'var(--primary-subtle)' }}>
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--primary)' }} /> Inbox</span>
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>{conversationList.length}</span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl px-3 py-2 transition cursor-pointer hover:scale-[1.01]" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--foreground-subtle)' }} /> Sent
                </div>
                <div className="flex items-center gap-2 rounded-2xl px-3 py-2 transition cursor-pointer hover:scale-[1.01]" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--foreground-subtle)' }} /> Drafts
                </div>
              </div>
            </div>

            <div className="rounded-3xl p-4 text-xs backdrop-blur-md" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', color: 'var(--foreground-muted)' }}>
              <div className="font-semibold" style={{ color: 'var(--foreground)' }}>What&apos;s XMTP mail?</div>
              <p className="mt-1 leading-relaxed">Threads here are encrypted on XMTP and render like email. No servers or IMAP folders — just wallet-linked messaging.</p>
            </div>
          </aside>


          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-3xl p-3" style={{ background: 'var(--surface-glass)', boxShadow: 'var(--shadow-inner)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex flex-1 gap-3 overflow-hidden">
              <section className="w-full max-w-md shrink-0 overflow-hidden rounded-2xl backdrop-blur-md" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Inbox</div>
                      <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>Styled like Gmail, powered by XMTP</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-full px-3 py-1 text-xs font-semibold transition sm:hidden"
                      style={{ color: 'var(--primary)', border: '1px solid var(--primary-subtle)', background: 'transparent' }}
                      onClick={() => setComposeOpen(true)}
                    >
                      Compose
                    </button>
                  </div>
                  <div className="mt-2 sm:hidden">
                    <input
                      className="w-full rounded-full px-4 py-2 text-sm outline-none transition"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--foreground)', boxShadow: 'var(--shadow-inner)' }}
                      placeholder="Search"
                      value={search}
                      onChange={(e) => setSearch(e.currentTarget.value)}
                    />
                  </div>
                </div>
                <div className="h-full overflow-y-auto">
                  {conversationList.length === 0 ? (
                    <div className="px-4 py-6 text-sm" style={{ color: 'var(--foreground-muted)' }}>No conversations yet.</div>
                  ) : (
                    conversationList.map((summary) => {
                      if (summary.kind === 'welcome') {
                        const isSelected = selectedConversationId === summary.id;
                        return (
                          <button
                            key={summary.id}
                            type="button"
                            className="w-full px-4 py-3 text-left transition hover:scale-[1.005]"
                            style={{
                              borderBottom: '1px solid var(--border)',
                              background: isSelected ? 'var(--welcome-bg)' : 'transparent'
                            }}
                            onClick={() => setSelectedConversationId(summary.id)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 truncate">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--welcome-bg)', color: 'var(--welcome-fg)', border: '1px solid var(--welcome-border)' }}>Hi</span>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{summary.subject}</div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--welcome-fg)' }}>
                                    <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: 'var(--welcome-bg)', border: '1px solid var(--welcome-border)' }}>Welcome</span>
                                    <span className="truncate">Product tour</span>
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 text-xs" style={{ color: 'var(--foreground-muted)' }}>{formatTimestamp(summary.timestamp)}</div>
                            </div>
                            <div className="mt-1 truncate text-xs" style={{ color: 'var(--foreground-muted)' }}>{summary.preview}</div>
                          </button>
                        );
                      }

                      const lastMessage = summary.lastMessage;
                      const lastMessageDate = lastMessage ? nsToDate(lastMessage.sentAtNs) : undefined;
                      const label = summary.peerAddress ?? summary.peerInboxId ?? summary.conversation.id;
                      const decodedLast = lastMessage ? decodeXmtpEmail(lastMessage.content) : null;
                      const preview = decodedLast
                        ? decodedLast.kind === 'email'
                          ? decodedLast.email.subject || '(no subject)'
                          : decodedLast.text
                        : 'No messages yet.';
                      const isSelected = selectedConversationId === summary.id;

                      return (
                        <button
                          key={summary.id}
                          type="button"
                          className="w-full px-4 py-3 text-left transition hover:scale-[1.005]"
                          style={{
                            borderBottom: '1px solid var(--border)',
                            background: isSelected ? 'var(--primary-subtle)' : 'transparent'
                          }}
                          onClick={() => {
                            setSelectedConversationId(summary.id);
                            void loadMessagesForConversation(summary.conversation);
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 truncate">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--surface)', color: 'var(--foreground-muted)', border: '1px solid var(--border-subtle)' }}>
                                {label.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{label}</div>
                                <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--foreground-muted)' }}>Encrypted thread on XMTP</div>
                              </div>
                            </div>
                            <div className="shrink-0 text-xs" style={{ color: 'var(--foreground-muted)' }}>{formatTimestamp(lastMessageDate)}</div>
                          </div>
                          <div className="mt-1 truncate text-xs" style={{ color: 'var(--foreground-muted)' }}>{preview}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="min-w-0 flex-1 overflow-hidden">
                {selectedConversation ? (
                  selectedConversation.kind === 'welcome' ? (
                    <WelcomeThread conversation={selectedConversation} />
                  ) : (
                    <Thread
                      conversation={selectedConversation.conversation}
                      messages={selectedMessages}
                      selfInboxId={xmtpClient.inboxId}
                      inboxDetails={inboxDetails}
                      threadTitle={selectedConversation.peerAddress ?? selectedConversation.peerInboxId ?? shortenInboxId(selectedConversation.id)}
                      threadSubtitle="Encrypted on XMTP"
                      onReply={(options) => handleSendReply(options)}
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl text-sm backdrop-blur-md" style={{ background: 'var(--card-bg)', color: 'var(--foreground-muted)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)' }}>
                    Select a conversation to read messages.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm p-4 sm:items-center" style={{ background: 'var(--overlay)' }}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl" style={{ background: 'var(--modal-bg)', boxShadow: 'var(--shadow-xl)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>New message</div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm transition"
                style={{ color: 'var(--foreground-muted)' }}
                onClick={() => {
                  setComposeOpen(false);
                  setComposeError(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {composeError ? <div className="text-sm" style={{ color: 'var(--accent-error)' }}>{composeError}</div> : null}

              <div>
                <label className="block text-xs font-semibold" style={{ color: 'var(--foreground-muted)' }}>To</label>
                <input
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm outline-none transition"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--foreground)' }}
                  placeholder="deanpierce.eth@xmtp.mx"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.currentTarget.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold" style={{ color: 'var(--foreground-muted)' }}>Subject</label>
                <input
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm outline-none transition"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--foreground)' }}
                  placeholder="(no subject)"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.currentTarget.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold" style={{ color: 'var(--foreground-muted)' }}>Message</label>
                <textarea
                  className="mt-1 min-h-[160px] w-full resize-y rounded-xl px-3 py-2 text-sm outline-none transition"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--foreground)' }}
                  placeholder="Write your message…"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-semibold transition"
                style={{ color: 'var(--foreground-muted)' }}
                onClick={() => setComposeOpen(false)}
                disabled={composeIsSending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-md)' }}
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
