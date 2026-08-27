'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client, ConsentState, ConversationType, DecodedMessage, Dm, SortDirection } from '@xmtp/browser-sdk';
import type { Identifier, IdentifierKind, Signer } from '@xmtp/browser-sdk';
import { ethers } from 'ethers';
import { getBytecode } from '@wagmi/core';
import { hexToBytes } from 'viem';
import { wagmiConfig } from '@/lib/wagmiConfig';
import { decodeXmtpEmail, encodeXmtpEmailV1 } from '@/lib/xmtpEmail';
import { isHexAddress, parseRecipient, shortenAddress } from '@/lib/xmtpAddressing';
import { ThemeToggle } from './ThemeContext';
import { WalletConnectButton } from './WalletConnectButton';
import { useWalletSession } from './WalletSessionProvider';

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
    'Hi there,\n\nThanks for opening xmtp.mx — a Gmail-inspired inbox that speaks the XMTP messaging network.\n\nWhen you connect a wallet, it signs XMTP identity updates directly and this browser becomes one of your XMTP installations. Messages are encrypted end-to-end and stay on XMTP; there is no central inbox server here.\n\nYou can send to onchain addresses or ENS names (e.g. deanpierce.eth). SMTP delivery is on the roadmap, but today you’ll want to message XMTP peers.\n\nHave fun, and thanks for testing!',
  timestamp: new Date(),
};

const ETHEREUM_IDENTIFIER_KIND: IdentifierKind = 'Ethereum';
const WALLET_INSPECTION_TIMEOUT_MS = 15_000;
const XMTP_CLIENT_INIT_TIMEOUT_MS = 45_000;
const XMTP_REGISTRATION_TIMEOUT_MS = 45_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ===== DEMO MODE MOCK DATA =====
type DemoMessage = {
  id: string;
  senderInboxId: string;
  content: string;
  sentAt: Date;
  isEmail: boolean;
  subject?: string;
};

type DemoModalRect = {
  x: number;
  y: number;
  width: number;
  height: number;
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
  wasmError: string | null;
  wasmInitStalled: boolean;
  xmtpEnv: 'local' | 'dev' | 'production';
  xmtpInitStalled: boolean;
}) {
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
      wasmError,
      wasmInitStalled,
      xmtpEnv,
      xmtpInitStalled,
    ],
  );

  return (
    <div
      className="mt-4 w-full max-w-xl rounded-2xl border px-4 py-3 text-left shadow-sm"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
    >
      <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Startup status</div>
      <div className="mt-2 space-y-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
        {items.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={['mt-0.5 h-2 w-2 shrink-0 rounded-full', toneDotClass(item.tone)].join(' ')} />
              <span className="shrink-0 font-semibold" style={{ color: 'var(--foreground)' }}>{item.label}</span>
            </div>
            <div className="min-w-0 text-right" style={{ color: 'var(--foreground)' }}>
              <span className="break-words">{item.value}</span>
            </div>
          </div>
        ))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs font-semibold" style={{ color: 'var(--foreground)' }}>Debug details</summary>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
          Enable console logs:{' '}
          <code className="rounded px-1 py-0.5" style={{ background: 'var(--background-subtle)', color: 'var(--foreground)' }}>
            {"localStorage.setItem('xmtp.mx.debug','1')"}
          </code>
        </div>
        <pre
          className="mt-2 max-h-56 overflow-auto rounded-xl px-3 py-2 text-[11px]"
          style={{ background: 'var(--background-subtle)', color: 'var(--foreground)' }}
        >
          {diagnosticsText}
        </pre>
      </details>
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
    <div className="flex h-full flex-col overflow-hidden rounded-[14px]" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="text-base font-semibold tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>{threadTitle ?? shortenInboxId(conversation.id)}</div>
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
                    className="max-w-[720px] rounded-2xl px-4 py-3"
                    style={{
                      background: isSelf ? 'var(--primary)' : 'var(--surface)',
                      border: isSelf ? '1px solid transparent' : '1px solid var(--border)',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs" style={{ color: isSelf ? 'rgba(255,255,255,0.72)' : 'var(--foreground-muted)' }}>
                      <div className="truncate">{isSelf ? 'You' : senderLabel(message.senderInboxId)}</div>
                      <div className="shrink-0">{formatTimestamp(sentAt)}</div>
                    </div>

                    {decoded.kind === 'email' ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>
                          {decoded.email.subject || '(no subject)'}
                        </div>
                        <div className="whitespace-pre-wrap text-sm" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{decoded.email.body}</div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{decoded.text}</div>
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

function WelcomeThread({
  conversation,
  onClose,
  onHeaderMouseDown,
}: {
  conversation: WelcomeConversationSummary;
  onClose?: () => void;
  onHeaderMouseDown?: (event: React.MouseEvent) => void;
}) {
  const paragraphs = useMemo(() => conversation.body.split('\n\n'), [conversation.body]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px]" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
      <div
        className="flex items-start justify-between gap-3 px-6 py-5"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: onHeaderMouseDown ? 'move' : undefined, userSelect: onHeaderMouseDown ? 'none' : undefined }}
        onMouseDown={onHeaderMouseDown}
      >
        <div className="min-w-0">
          <div className="truncate text-base font-semibold tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>{conversation.subject}</div>
          <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>From XMTP Mailroom • {formatTimestamp(conversation.timestamp)}</div>
        </div>
        {onClose ? (
          <button
            data-modal-action="true"
            type="button"
            aria-label="Close welcome thread"
            className="btn-nav shrink-0"
            style={{ padding: '6px' }}
            onClick={onClose}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
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
  const xmtpInitAttemptRef = useRef(0);
  const xmtpInitInFlightRef = useRef<number | null>(null);
  const previousActiveAddressRef = useRef<string | undefined>();

  const xmtpEnv = (process.env.NEXT_PUBLIC_XMTP_ENV ?? 'production') as 'local' | 'dev' | 'production';

  const {
    address: activeAddress,
    chainId: activeChainId,
    isConnected: hasActiveWallet,
    signMessage,
  } = useWalletSession();

  useEffect(() => {
    const normalizedAddress = activeAddress?.toLowerCase();
    if (previousActiveAddressRef.current === normalizedAddress) return;

    previousActiveAddressRef.current = normalizedAddress;
    xmtpInitAttemptRef.current += 1;
    xmtpInitInFlightRef.current = null;
    setXmtpLoading(false);
    setXmtpError(null);
    setXmtpInitStalled(false);
  }, [activeAddress]);

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
  const [demoSelectedId, setDemoSelectedId] = useState<string | null>(null);
  const [demoView, setDemoView] = useState<'inbox' | 'sent' | 'contacts'>('inbox');
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const demoMailListRef = useRef<HTMLDivElement | null>(null);
  const [demoMailListSize, setDemoMailListSize] = useState({ width: 0, height: 0 });
  const demoMailListSizeRef = useRef({ width: 0, height: 0 });
  const [demoModalRect, setDemoModalRect] = useState<DemoModalRect>({ x: 12, y: 12, width: 0, height: 0 });
  const demoModalRectRef = useRef<DemoModalRect>(demoModalRect);
  const demoModalPointerRef = useRef<{
    mode: 'drag' | 'resize';
    startX: number;
    startY: number;
    origin: DemoModalRect;
  } | null>(null);

  const enableDemoMode = useCallback((options?: { fromUrl?: boolean }) => {
    setDemoMode(true);
    setDemoSelectedId(null);
    setDemoView('inbox');
    setDemoNotice(null);
    if (typeof window !== 'undefined' && !options?.fromUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('demo', '1');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const disableDemoMode = useCallback(() => {
    setDemoMode(false);
    setDemoSelectedId(null);
    setComposeOpen(false);
    setComposeError(null);
    setDemoNotice(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('demo')) {
        enableDemoMode({ fromUrl: true });
      }
    }
  }, [enableDemoMode]);

  useEffect(() => {
    console.log(`[xmtp.mx] compose modal ${composeOpen ? 'open' : 'close'}`, { demoMode });
  }, [composeOpen, demoMode]);

  useEffect(() => {
    if (!demoMode) return;
    console.log(
      `[xmtp.mx] demo thread modal ${demoSelectedId ? 'open' : 'close'}`,
      demoSelectedId ? { id: demoSelectedId } : undefined,
    );
  }, [demoMode, demoSelectedId]);

  const clampDemoModalRect = useCallback(
    (rect: DemoModalRect, size: { width: number; height: number }, options?: { resetIfZero?: boolean }) => {
      const margin = 12;
      const minWidth = Math.floor(size.width * 0.67);
      const maxWidth = Math.max(minWidth, size.width - margin * 2);
      const minHeight = Math.min(size.height - margin * 2, Math.max(260, Math.floor(size.height * 0.6)));
      const maxHeight = Math.max(minHeight, size.height - margin * 2);

      let width = rect.width;
      let height = rect.height;
      let x = rect.x;
      let y = rect.y;

      if (options?.resetIfZero && (!width || !height)) {
        width = Math.max(minWidth, Math.floor(size.width * 0.8));
        height = Math.max(minHeight, Math.floor(size.height * 0.85));
        x = margin;
        y = margin;
      }

      width = Math.min(Math.max(width, minWidth), maxWidth);
      height = Math.min(Math.max(height, minHeight), maxHeight);
      x = Math.min(Math.max(x, margin), Math.max(margin, size.width - margin - width));
      y = Math.min(Math.max(y, margin), Math.max(margin, size.height - margin - height));

      return { x, y, width, height };
    },
    [],
  );

  useEffect(() => {
    demoModalRectRef.current = demoModalRect;
  }, [demoModalRect]);

  useEffect(() => {
    if (!demoMode) return;
    const node = demoMailListRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateSize = (width: number, height: number) => {
      const size = { width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) };
      demoMailListSizeRef.current = size;
      setDemoMailListSize(size);
    };

    const rect = node.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [demoMode]);

  useEffect(() => {
    if (!demoMailListSize.width || !demoMailListSize.height) return;
    setDemoModalRect((prev) => clampDemoModalRect(prev, demoMailListSize, { resetIfZero: true }));
  }, [clampDemoModalRect, demoMailListSize]);

  const handleDemoPointerMove = useCallback(
    (event: MouseEvent) => {
      const state = demoModalPointerRef.current;
      if (!state) return;
      const size = demoMailListSizeRef.current;
      if (!size.width || !size.height) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      const next =
        state.mode === 'drag'
          ? { ...state.origin, x: state.origin.x + dx, y: state.origin.y + dy }
          : { ...state.origin, width: state.origin.width + dx, height: state.origin.height + dy };

      setDemoModalRect(clampDemoModalRect(next, size));
    },
    [clampDemoModalRect],
  );

  const handleDemoPointerUp = useCallback(() => {
    demoModalPointerRef.current = null;
    window.removeEventListener('mousemove', handleDemoPointerMove);
    window.removeEventListener('mouseup', handleDemoPointerUp);
  }, [handleDemoPointerMove]);

  const startDemoDrag = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-modal-action="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      demoModalPointerRef.current = {
        mode: 'drag',
        startX: event.clientX,
        startY: event.clientY,
        origin: demoModalRectRef.current,
      };
      window.addEventListener('mousemove', handleDemoPointerMove);
      window.addEventListener('mouseup', handleDemoPointerUp);
    },
    [handleDemoPointerMove, handleDemoPointerUp],
  );

  const startDemoResize = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      demoModalPointerRef.current = {
        mode: 'resize',
        startX: event.clientX,
        startY: event.clientY,
        origin: demoModalRectRef.current,
      };
      window.addEventListener('mousemove', handleDemoPointerMove);
      window.addEventListener('mouseup', handleDemoPointerUp);
    },
    [handleDemoPointerMove, handleDemoPointerUp],
  );

  // Close the topmost demo surface on Escape.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (composeOpen) {
        setComposeOpen(false);
        setComposeError(null);
      } else if (demoSelectedId) {
        setDemoSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [composeOpen, demoSelectedId]);


  const debug = useCallback(
    (...args: unknown[]) => {
      if (!debugEnabled) return;
      console.debug('[xmtp.mx]', ...args);
    },
    [debugEnabled],
  );

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
    wasmError,
    xmtpInitStalled,
    xmtpEnv,
    xmtpError,
    xmtpLoading,
    conversationsById,
  ]);

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
    if (!hasActiveWallet || !activeAddress) {
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
    if (xmtpInitInFlightRef.current !== null) {
      debug('XMTP init skipped: already initializing');
      return;
    }

    const attemptId = ++xmtpInitAttemptRef.current;
    xmtpInitInFlightRef.current = attemptId;
    const startedAt = Date.now();
    let warnTimer: ReturnType<typeof setTimeout> | undefined;
    let createdClient: Client | null = null;
    const ensureCurrentAttempt = () => {
      if (attemptId !== xmtpInitAttemptRef.current) {
        throw new Error('XMTP initialization was superseded by a wallet change.');
      }
    };

    try {
      setXmtpInitStalled(false);
      setXmtpLoading(true);
      setXmtpError(null);
      const inspectionChainIds = Array.from(
        new Set(
          [activeChainId, 8453].filter(
            (chainId): chainId is 1 | 8453 | 84532 =>
              chainId === 1 || chainId === 8453 || chainId === 84532,
          ),
        ),
      );
      const inspections = await withTimeout(
        Promise.all(
          inspectionChainIds.map(async (chainId) => {
            try {
              const bytecode = await getBytecode(wagmiConfig, {
                address: activeAddress,
                chainId,
              });
              return { chainId, bytecode };
            } catch (error) {
              debug('wallet bytecode inspection failed', { chainId, error });
              return null;
            }
          }),
        ),
        WALLET_INSPECTION_TIMEOUT_MS,
        'Wallet inspection timed out. Check your network connection and try again.',
      );
      ensureCurrentAttempt();
      const successfulInspections = inspections.filter(
        (inspection): inspection is NonNullable<typeof inspection> => Boolean(inspection),
      );
      if (successfulInspections.length === 0) {
        throw new Error('Could not inspect this wallet account. Check your network connection and try again.');
      }
      const smartAccount = successfulInspections.find(({ bytecode }) => {
        const normalized = bytecode?.trim() ?? '';
        const isEip7702Delegation = /^0xef0100[0-9a-f]{40}$/i.test(normalized);
        return Boolean(normalized && normalized !== '0x' && !isEip7702Delegation);
      });
      const walletType = smartAccount ? 'SCW' as const : 'EOA' as const;
      const signerChainId = smartAccount?.chainId ?? activeChainId;
      if (walletType === 'SCW' && !signerChainId) {
        throw new Error('Reconnect the smart account on its network before continuing.');
      }
      debug('XMTP init starting', { env: xmtpEnv, chainId: signerChainId, walletType });
      warnTimer = setTimeout(() => {
        if (attemptId !== xmtpInitAttemptRef.current) return;
        setXmtpInitStalled(true);
        debug('XMTP init still pending after 10s');
      }, 10_000);

      const signerBase = {
        getIdentifier: () => ({ identifier: activeAddress, identifierKind: ETHEREUM_IDENTIFIER_KIND }),
        signMessage: async (message: string) => {
          const signature = await signMessage(message, activeAddress);
          return hexToBytes(signature);
        },
      };
      const xmtpSigner: Signer = walletType === 'SCW'
        ? { ...signerBase, type: 'SCW', getChainId: () => BigInt(signerChainId!) }
        : { ...signerBase, type: 'EOA' };

      const clientPromise = Client.create(xmtpSigner, {
        env: xmtpEnv,
        disableAutoRegister: true,
      });
      void clientPromise
        .then((lateClient) => {
          if (attemptId !== xmtpInitAttemptRef.current) lateClient.close();
        })
        .catch(() => {
          // The awaited path below reports initialization errors in the UI.
        });
      createdClient = await withTimeout(
        clientPromise,
        XMTP_CLIENT_INIT_TIMEOUT_MS,
        'Wallet signing or XMTP connection timed out. Reopen your wallet and try again.',
      );
      ensureCurrentAttempt();
      const isRegistered = await withTimeout(
        createdClient.isRegistered(),
        XMTP_REGISTRATION_TIMEOUT_MS,
        'Checking this XMTP installation timed out. Check your connection and try again.',
      );
      ensureCurrentAttempt();
      if (!isRegistered) {
        debug('registering new XMTP browser installation', { inboxId: createdClient.inboxId });
        await withTimeout(
          createdClient.register(),
          XMTP_REGISTRATION_TIMEOUT_MS,
          'XMTP registration timed out. Reopen your wallet and try again.',
        );
        ensureCurrentAttempt();
      }
      setXmtpClient(createdClient);
      debug('XMTP init resolved', { inboxId: createdClient.inboxId, address: activeAddress, walletType });
      debug('XMTP init completed', { ms: Date.now() - startedAt });
      if (createdClient.inboxId) {
        setInboxDetails((prev) => ({ ...prev, [createdClient!.inboxId!]: { address: activeAddress } }));
      }
      createdClient = null;
    } catch (err) {
      console.error('Error initializing XMTP client:', err);
      debug('XMTP init error', err);
      debug('XMTP init failed', { ms: Date.now() - startedAt });
      if (createdClient) {
        try {
          createdClient.close();
        } catch (closeError) {
          debug('failed to close incomplete XMTP client', closeError);
        }
      }
      if (attemptId === xmtpInitAttemptRef.current) {
        xmtpInitAttemptRef.current += 1;
        setXmtpError(err instanceof Error ? err.message : 'Failed to initialize XMTP');
      }
    } finally {
      if (warnTimer) clearTimeout(warnTimer);
      if (xmtpInitInFlightRef.current === attemptId) {
        xmtpInitInFlightRef.current = null;
        setXmtpLoading(false);
      }
    }
  }, [
    activeAddress,
    activeChainId,
    clientAddress,
    debug,
    hasActiveWallet,
    isWasmInitialized,
    signMessage,
    xmtpClient,
    xmtpEnv,
  ]);

  useEffect(() => {
    void initializeXmtpClient();
  }, [initializeXmtpClient]);

  useEffect(() => {
    if (!xmtpClient) return;
    const walletMatchesClient = Boolean(
      activeAddress && clientAddress && activeAddress.toLowerCase() === clientAddress.toLowerCase(),
    );
    if (hasActiveWallet && walletMatchesClient) return;

    setXmtpClient(null);
    void Promise.resolve()
      .then(() => xmtpClient.close())
      .catch((error: unknown) => debug('failed to close XMTP client', error));
  }, [activeAddress, clientAddress, debug, hasActiveWallet, xmtpClient]);

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

  const handleDemoComposeSend = () => {
    const recipient = composeTo.trim();
    if (!recipient) {
      setComposeError('Add an ENS name or 0x address.');
      return;
    }
    if (!composeBody.trim()) {
      setComposeError('Write a message before sending.');
      return;
    }

    setComposeError(null);
    setComposeOpen(false);
    setDemoNotice(`Demo message prepared for ${recipient}. Connect a wallet to send it on XMTP.`);
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
  };

  // ===== DEMO MODE RENDER =====
  if (demoMode) {
    const welcomeConvo: WelcomeConversationSummary = { kind: 'welcome', id: WELCOME_CONVERSATION_ID, ...WELCOME_MESSAGE };
    const selectedDemo = demoSelectedId === WELCOME_CONVERSATION_ID
      ? welcomeConvo
      : DEMO_CONVERSATIONS.find(c => c.id === demoSelectedId);
    const lastSyncTime = new Date(Date.now() - 1000 * 60 * 2); // 2 mins ago for demo
    const normalizedDemoSearch = search.trim().toLowerCase();
    const showDemoWelcome = !normalizedDemoSearch || 'welcome xmtp team'.includes(normalizedDemoSearch);
    const filteredDemoConversations = DEMO_CONVERSATIONS.filter((conversation) => {
      if (!normalizedDemoSearch) return true;
      return (
        conversation.peerName?.toLowerCase().includes(normalizedDemoSearch) ||
        conversation.peerAddress.toLowerCase().includes(normalizedDemoSearch) ||
        conversation.messages.some((message) => message.content.toLowerCase().includes(normalizedDemoSearch))
      );
    });

    return (
      <div className="app-frame min-h-dvh">
        <div className="mx-auto flex h-dvh max-w-[1480px] flex-col gap-3 p-2 sm:p-4 lg:p-5">
          {/* Header */}
          <header className="header-glass flex min-h-16 items-center justify-between gap-3 px-3 py-2 animate-fade-in sm:px-5" style={{ borderRadius: '18px' }}>
            {/* Left: Logo + Title */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-black tracking-tight text-white" style={{ background: 'var(--primary)' }}>
                XM
              </div>
              <div>
                <div className="text-sm font-semibold tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>xmtp.mx</div>
                <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-success)' }}></span>
                  Synced {formatTimestamp(lastSyncTime)}
                </div>
              </div>
              <div className="ml-1.5 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                Demo
              </div>
            </div>

            {/* Right: Theme Toggle + Settings + Identity */}
            <div className="flex items-center gap-2">
              {/* Theme Toggle */}
              <div>
                <ThemeToggle />
              </div>

              {/* Identity / Profile */}
              <div className="hidden items-center gap-2 rounded-xl border px-2 py-1 sm:flex" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white" style={{ background: 'var(--primary)' }}>
                  DP
                </div>
                <div className="text-left">
                  <div className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>demo.eth</div>
                  <div className="text-[9px] font-mono" style={{ color: 'var(--foreground-muted)' }}>0x71C7...1F3a</div>
                </div>
              </div>

              <button type="button" className="btn-nav whitespace-nowrap" onClick={disableDemoMode}>
                Exit demo
              </button>
            </div>
          </header>

          {demoNotice ? (
            <div role="status" className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs shadow-sm" style={{ background: 'var(--accent-success-subtle)', borderColor: 'var(--accent-success)', color: 'var(--foreground)' }}>
              <span>{demoNotice}</span>
              <button type="button" className="font-semibold" onClick={() => setDemoNotice(null)}>Dismiss</button>
            </div>
          ) : null}

          {/* Main Content */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:flex-row sm:gap-3">
            {/* Sidebar */}
            <aside className="flex w-full shrink-0 flex-col animate-fade-in delay-1 sm:w-[196px]">
              <div className="sidebar-glass p-2 sm:p-3" style={{ borderRadius: '18px' }}>
                <nav aria-label="Demo mailbox" className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-col">
                  {/* Compose */}
                  <button
                    type="button"
                    className="btn-primary w-full"
                    style={{
                      height: '42px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                    onClick={() => {
                      setDemoSelectedId(null);
                      setComposeError(null);
                      setComposeOpen(true);
                    }}
                  >
                    <svg className="h-[14px] w-[14px]" style={{ flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M12 4v16m8-8H4" />
                    </svg>
                    <span style={{ lineHeight: '14px' }}>Compose</span>
                  </button>

                  <div className="my-1.5 hidden h-px sm:block" style={{ background: 'var(--border)' }}></div>

                  {/* Inbox */}
                  <button
                    type="button"
                    onClick={() => setDemoView('inbox')}
                    className="btn-nav w-full"
                    data-active={demoView === 'inbox' ? 'true' : undefined}
                    style={{ height: '32px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', paddingLeft: '10px', paddingRight: '10px' }}
                  >
                    <svg className="h-[14px] w-[14px] shrink-0" style={{ flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z" />
                      <path d="M22 6l-10 7L2 6" />
                    </svg>
                    <span style={{ lineHeight: '14px' }}>Inbox</span>
                    <span className="ml-auto rounded-full px-1.5 text-[10px] font-semibold" style={{ background: demoView === 'inbox' ? 'rgba(255,255,255,0.25)' : 'var(--primary)', color: 'white', lineHeight: '18px', height: '18px', display: 'flex', alignItems: 'center' }}>{DEMO_CONVERSATIONS.length + 1}</span>
                  </button>
                  {/* Sent */}
                  <button
                    type="button"
                    onClick={() => setDemoView('sent')}
                    className="btn-nav w-full"
                    data-active={demoView === 'sent' ? 'true' : undefined}
                    style={{ height: '32px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', paddingLeft: '10px', paddingRight: '10px' }}
                  >
                    <svg className="h-[14px] w-[14px] shrink-0" style={{ flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    <span style={{ lineHeight: '14px' }}>Sent</span>
                  </button>
                  {/* Contacts */}
                  <button
                    type="button"
                    onClick={() => setDemoView('contacts')}
                    className="btn-nav w-full"
                    data-active={demoView === 'contacts' ? 'true' : undefined}
                    style={{ height: '32px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', paddingLeft: '10px', paddingRight: '10px' }}
                  >
                    <svg className="h-[14px] w-[14px] shrink-0" style={{ flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span style={{ lineHeight: '14px' }}>Contacts</span>
                  </button>
                </nav>
              </div>
            </aside>

            {/* Mail List */}
            <div
              className="relative flex min-w-0 flex-1 overflow-hidden card-shiny animate-fade-in delay-2"
              style={{ borderRadius: '18px', boxShadow: 'var(--shadow-md)' }}
              ref={demoMailListRef}
              data-testid="demo-mail-list"
            >
              {demoView === 'contacts' ? (
                /* Contacts View */
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>Contacts</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>People you&apos;ve messaged</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {DEMO_CONVERSATIONS.map((c, idx) => (
                      <div
                        key={c.id}
                        className="card-shiny flex cursor-pointer items-center gap-3 p-3 animate-slide-up"
                        style={{ borderRadius: '10px', animationDelay: `${idx * 50}ms` }}
                        onClick={() => {
                          setComposeOpen(false);
                          setDemoView('inbox');
                          setDemoSelectedId(c.id);
                        }}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                          {(c.peerName || c.peerAddress).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{c.peerName || 'Unknown'}</div>
                          <div className="truncate text-[11px] font-mono" style={{ color: 'var(--foreground-muted)' }}>{c.peerAddress}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : demoView === 'sent' ? (
                /* Sent View */
                <div className="flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-2 px-4 py-3 glass-strong sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="text-sm font-semibold tracking-[-0.01em]" style={{ color: 'var(--foreground)' }}>Sent</div>
                      <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>Messages you&apos;ve sent</div>
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    {DEMO_CONVERSATIONS.map((c) => {
                      const sentMsgs = c.messages.filter(m => m.senderInboxId === 'self');
                      return sentMsgs.map((msg, idx) => (
                        <div
                          key={msg.id}
                          className="card-shiny cursor-pointer p-3 animate-slide-up"
                          style={{ borderRadius: '10px', animationDelay: `${idx * 50}ms` }}
                          onClick={() => {
                            setComposeOpen(false);
                            setDemoView('inbox');
                            setDemoSelectedId(c.id);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                            <span>To: <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{c.peerName || c.peerAddress}</span></span>
                            <span className="font-mono">{formatTimestamp(msg.sentAt)}</span>
                          </div>
                          {msg.subject && <div className="mt-1.5 text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{msg.subject}</div>}
                          <div className="mt-1.5 text-sm truncate" style={{ color: 'var(--foreground-muted)' }}>{msg.content}</div>
                        </div>
                      ));
                    })}
                  </div>
                </div>
              ) : (
                /* Inbox View */
                <div className="flex-1 overflow-y-auto">
                  {/* Search + Header */}
                  <div className="flex items-center justify-between px-4 py-3 glass-strong" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="text-sm font-semibold tracking-[-0.01em]" style={{ color: 'var(--foreground)' }}>Inbox</div>
                      <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>{DEMO_CONVERSATIONS.length + 1} messages</div>
                    </div>
                    <div className="relative w-full sm:w-auto">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--foreground-subtle)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        aria-label="Search demo inbox"
                        className="input w-full text-sm pl-9 sm:w-52"
                        placeholder="Search inbox"
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        style={{ height: '32px' }}
                      />
                    </div>
                  </div>
                  {/* Message Rows */}
                  <div>
                    {/* Welcome row */}
                    {showDemoWelcome && (
                      <button
                        type="button"
                        className="inbox-row w-full text-left animate-fade-in"
                        onClick={() => {
                          setComposeOpen(false);
                          setDemoSelectedId(WELCOME_CONVERSATION_ID);
                        }}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ background: 'var(--primary)', color: 'white' }}>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                        </div>
                        <div className="min-w-0 truncate font-semibold text-sm" style={{ color: 'var(--foreground)' }}>XMTP Team</div>
                        <div className="hidden min-w-0 truncate text-sm sm:block" style={{ color: 'var(--foreground-muted)' }}>Welcome to xmtp.mx — Your decentralized inbox</div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ background: 'var(--accent-success-subtle)', color: 'var(--accent-success)' }}>New</span>
                          <span className="text-[11px] font-mono" style={{ color: 'var(--foreground-subtle)' }}>Now</span>
                        </div>
                      </button>
                    )}
                    {/* Conversations */}
                    {filteredDemoConversations
                      .map((convo, idx) => {
                        const lastMsg = convo.messages[convo.messages.length - 1];
                        const subject = lastMsg?.isEmail && lastMsg.subject ? lastMsg.subject : lastMsg?.content.slice(0, 60);
                        return (
                          <button
                            type="button"
                            key={convo.id}
                            className="inbox-row w-full text-left animate-fade-in"
                            style={{ animationDelay: `${(idx + 1) * 50}ms` }}
                            onClick={() => {
                              setComposeOpen(false);
                              setDemoSelectedId(convo.id);
                            }}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold" style={{ background: 'var(--background-subtle)', color: 'var(--foreground-muted)', border: '1px solid var(--border)' }}>
                              {(convo.peerName || convo.peerAddress).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 truncate font-semibold text-sm" style={{ color: 'var(--foreground)' }}>{convo.peerName || convo.peerAddress}</div>
                            <div className="hidden min-w-0 truncate text-sm sm:block" style={{ color: 'var(--foreground-muted)' }}>{subject}</div>
                            <div className="text-[11px] font-mono shrink-0" style={{ color: 'var(--foreground-subtle)' }}>{formatTimestamp(convo.lastMessageAt)}</div>
                          </button>
                        );
                      })}
                    {!showDemoWelcome && filteredDemoConversations.length === 0 ? (
                      <div className="px-5 py-10 text-center">
                        <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>No matching messages</div>
                        <div className="mt-1 text-xs" style={{ color: 'var(--foreground-muted)' }}>Try an ENS name, address, or message text.</div>
                      </div>
                    ) : null}
                    {showDemoWelcome && filteredDemoConversations.length > 0 ? (
                      <div className="hidden min-h-64 flex-col items-center justify-center border-t px-6 text-center sm:flex" style={{ borderColor: 'var(--border-subtle)', background: 'var(--background-subtle)' }}>
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                            <path d="M4 5.5h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2v-9a2 2 0 012-2z" />
                            <path d="M22 7l-10 6L2 7" />
                          </svg>
                        </div>
                        <div className="mt-4 text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Choose a conversation to read</div>
                        <div className="mt-1 max-w-xs text-xs leading-relaxed" style={{ color: 'var(--foreground-muted)' }}>Threads open in a focused window, so your inbox stays close at hand.</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Thread Modal Overlay (Demo) */}
              {demoSelectedId && (
                <div className="absolute inset-0 z-20 animate-fade-in">
                  <div
                    className="absolute inset-0"
                    style={{ background: 'var(--overlay)', opacity: 0.18 }}
                    onClick={() => setDemoSelectedId(null)}
                  />
                  <div
                    className="absolute modal-glass flex flex-col overflow-hidden animate-scale-in relative"
                    style={{
                      borderRadius: 'var(--radius-2xl)',
                      left: demoModalRect.x,
                      top: demoModalRect.y,
                      width: demoModalRect.width,
                      height: demoModalRect.height,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Demo conversation"
                    data-testid="demo-conversation-dialog"
                  >
                    {selectedDemo && 'kind' in selectedDemo && selectedDemo.kind === 'welcome' ? (
                      <WelcomeThread
                        conversation={selectedDemo}
                        onClose={() => setDemoSelectedId(null)}
                        onHeaderMouseDown={startDemoDrag}
                      />
                    ) : selectedDemo && !('kind' in selectedDemo) ? (
                      <>
                        {/* Modal Header */}
                        <div
                          className="flex items-center justify-between px-4 py-3 glass-strong shrink-0"
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'move', userSelect: 'none' }}
                          onMouseDown={startDemoDrag}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold" style={{ background: 'var(--primary)', color: 'white' }}>
                              {(selectedDemo.peerName || selectedDemo.peerAddress).slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-base font-bold" style={{ color: 'var(--foreground)' }}>{selectedDemo.peerName || selectedDemo.peerAddress}</div>
                              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                <span className="flex items-center gap-1">
                                  <svg className="h-3 w-3" style={{ color: 'var(--accent-success)' }} fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
                                  </svg>
                                  Encrypted
                                </span>
                                <span>•</span>
                                <span>{selectedDemo.messages.length} messages</span>
                              </div>
                            </div>
                          </div>
                          <button
                            data-modal-action="true"
                            type="button"
                            aria-label="Close conversation"
                            className="btn-nav"
                            style={{ padding: '6px' }}
                            onClick={() => setDemoSelectedId(null)}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        {/* Modal Body - Messages */}
                        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ background: 'var(--background-subtle)' }}>
                          <div className="space-y-3">
                            {selectedDemo.messages.map((msg, idx) => {
                              const isSelf = msg.senderInboxId === 'self';
                              return (
                                <div key={msg.id} className={`flex animate-slide-up ${isSelf ? 'justify-end' : 'justify-start'}`} style={{ animationDelay: `${idx * 50}ms` }}>
                                  <div
                                    className="max-w-[360px] px-4 py-3"
                                    style={{
                                      background: isSelf ? 'var(--primary)' : 'var(--surface)',
                                      border: isSelf ? 'none' : '1px solid var(--border)',
                                      borderRadius: isSelf ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                      boxShadow: 'var(--shadow-sm)'
                                    }}
                                  >
                                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]" style={{ color: isSelf ? 'rgba(255,255,255,0.8)' : 'var(--foreground-muted)' }}>
                                      <div className="font-semibold">{isSelf ? 'You' : (selectedDemo.peerName || 'Peer')}</div>
                                      <div className="font-mono">{formatTimestamp(msg.sentAt)}</div>
                                    </div>
                                    {msg.isEmail && msg.subject && (
                                      <div className="mb-1.5 text-sm font-semibold" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{msg.subject}</div>
                                    )}
                                    <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: isSelf ? 'white' : 'var(--foreground)' }}>{msg.content}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {/* Modal Footer - Reply */}
                        <div className="px-4 py-3 glass-strong shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
                          <div className="flex gap-2">
                            <input
                              className="input flex-1 text-sm"
                              placeholder="Reply... (demo mode)"
                              disabled
                              style={{ height: '40px' }}
                            />
                            <button
                              type="button"
                              className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:transform-none"
                              style={{ height: '40px', paddingLeft: '1rem', paddingRight: '1rem' }}
                              disabled
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                              </svg>
                              Send
                            </button>
                          </div>
                        </div>
                      </>
                    ) : null}
                    <div
                      data-modal-action="true"
                      className="absolute bottom-2 right-2 h-4 w-4 cursor-nwse-resize rounded-sm"
                      style={{ border: '1px solid var(--border)', background: 'var(--surface-glass)' }}
                      onMouseDown={startDemoResize}
                    />
                  </div>
                </div>
              )}

              {/* Compose Modal for Demo Mode */}
              {composeOpen && (
                <div className="absolute inset-0 z-30 animate-fade-in">
                  <div
                    className="absolute inset-0"
                    style={{ background: 'var(--overlay)', opacity: 0.18 }}
                    onClick={() => setComposeOpen(false)}
                  />
                  <div
                    className="absolute modal-glass flex flex-col overflow-hidden animate-scale-in relative"
                    style={{
                      borderRadius: '16px',
                      left: demoModalRect.x,
                      top: demoModalRect.y,
                      width: demoModalRect.width,
                      height: demoModalRect.height,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="demo-compose-title"
                    data-testid="demo-compose-dialog"
                  >
                    {/* Modal Header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 glass-strong shrink-0"
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'move', userSelect: 'none' }}
                      onMouseDown={startDemoDrag}
                    >
                      <div id="demo-compose-title" className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>New message</div>
                      <button
                        data-modal-action="true"
                        type="button"
                        aria-label="Close compose"
                        className="btn-nav"
                        style={{ padding: '6px' }}
                        onClick={() => {
                          setComposeOpen(false);
                          setComposeError(null);
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Modal Body */}
                    <div className="flex-1 p-4 space-y-3" style={{ background: 'var(--background-subtle)' }}>
                      {composeError ? (
                        <div role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--accent-error)', background: 'var(--accent-error-subtle)', color: 'var(--accent-error)' }}>
                          {composeError}
                        </div>
                      ) : null}
                      <div>
                        <label htmlFor="demo-compose-to" className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--foreground-muted)', lineHeight: '1' }}>To</label>
                        <input
                          id="demo-compose-to"
                          autoFocus
                          className="input w-full text-sm"
                          placeholder="vitalik.eth or 0x..."
                          value={composeTo}
                          onChange={(event) => {
                            setComposeTo(event.currentTarget.value);
                            setComposeError(null);
                          }}
                          style={{ height: '36px', borderRadius: '8px', lineHeight: '34px', padding: '0 12px' }}
                        />
                      </div>
                      <div>
                        <label htmlFor="demo-compose-subject" className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--foreground-muted)', lineHeight: '1' }}>Subject</label>
                        <input
                          id="demo-compose-subject"
                          className="input w-full text-sm"
                          placeholder="(optional)"
                          value={composeSubject}
                          onChange={(event) => setComposeSubject(event.currentTarget.value)}
                          style={{ height: '36px', borderRadius: '8px', lineHeight: '34px', padding: '0 12px' }}
                        />
                      </div>
                      <div>
                        <label htmlFor="demo-compose-body" className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--foreground-muted)', lineHeight: '1' }}>Message</label>
                        <textarea
                          id="demo-compose-body"
                          className="input w-full text-sm resize-none"
                          placeholder="Write your message..."
                          rows={6}
                          value={composeBody}
                          onChange={(event) => {
                            setComposeBody(event.currentTarget.value);
                            setComposeError(null);
                          }}
                          style={{ borderRadius: '8px', padding: '10px 12px' }}
                        />
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="px-4 py-3 glass-strong shrink-0 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
                      <button
                        data-modal-action="true"
                        type="button"
                        className="btn-nav"
                        style={{ padding: '8px 16px', fontSize: '13px' }}
                        onClick={() => {
                          setComposeOpen(false);
                          setComposeError(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        data-modal-action="true"
                        type="button"
                        className="btn-primary flex items-center gap-1.5"
                        style={{ height: '34px', padding: '0 16px', fontSize: '13px', borderRadius: '8px' }}
                        onClick={handleDemoComposeSend}
                      >
                        <svg className="h-[14px] w-[14px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send
                      </button>
                    </div>
                    <div
                      data-modal-action="true"
                      className="absolute bottom-2 right-2 h-4 w-4 cursor-nwse-resize rounded-sm"
                      style={{ border: '1px solid var(--border)', background: 'var(--surface-glass)' }}
                      onMouseDown={startDemoResize}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }


  if (wasmError) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <div className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Failed to initialize</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--foreground-muted)' }}>WebAssembly error: {wasmError}</div>
            <StartupStatusPanel
              xmtpEnv={xmtpEnv}
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
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh items-center justify-center px-6 text-center">
          <div>
            <div className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>xmtp.mx</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--foreground-muted)' }}>Initializing security module…</div>
            <StartupStatusPanel
              xmtpEnv={xmtpEnv}
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

  if (!hasActiveWallet || !activeAddress) {
    return (
      <div className="hero-metallic min-h-dvh text-white">
        <nav className="landing-nav relative z-10">
          <div className="mx-auto flex h-20 max-w-[1320px] items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7568f2] text-[11px] font-black tracking-[-0.04em] text-white">XM</div>
              <div>
                <div className="text-sm font-semibold tracking-[-0.02em]">xmtp.mx</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Private mail</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 text-xs text-white/55 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> XMTP production
              </div>
              <ThemeToggle />
            </div>
          </div>
        </nav>

        <main className="relative z-[1] mx-auto flex min-h-[calc(100dvh-80px)] max-w-[1320px] items-center px-4 py-8 sm:px-8 sm:py-12">
          <div className="landing-panel w-full p-6 sm:p-10 lg:p-14">
            <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
              <section>
                <div className="landing-kicker text-[11px] font-semibold">Wallet-native · end-to-end encrypted</div>
                <h1 className="mt-6 max-w-2xl text-balance text-[clamp(3rem,6vw,5.8rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-white">
                  Your wallet has an inbox.
                </h1>
                <p className="mt-7 max-w-xl text-balance text-base leading-7 text-white/62 sm:text-lg">
                  XMTP conversations with the clarity of email. No account to create, no feed to manage, and no platform holding your messages.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="landing-wallet-action"><WalletConnectButton prominent /></div>
                  <button
                    type="button"
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/16 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:border-white/28 hover:bg-white/[0.1]"
                    onClick={() => enableDemoMode()}
                  >
                    Open demo inbox
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-white/45">
                  <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  No wallet needed for demo
                </div>

                <div className="mt-10 grid max-w-xl grid-cols-2 gap-6 text-sm text-white/55">
                  <div className="landing-feature">
                    <div className="font-semibold text-white">Direct identity</div>
                    <div className="mt-1 leading-relaxed">Your wallet signs XMTP updates. We never touch your key.</div>
                  </div>
                  <div className="landing-feature">
                    <div className="font-semibold text-white">Actually private</div>
                    <div className="mt-1 leading-relaxed">Conversations stay encrypted from sender to recipient.</div>
                  </div>
                </div>

                {xmtpError && <p className="mt-5 text-sm text-rose-300">{xmtpError}</p>}
              </section>

              <section className="relative py-3 lg:py-8">
                <div className="absolute -inset-5 rounded-[32px] border border-white/[0.06]" />
                <div className="landing-preview relative">
                  <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 sm:px-6">
                    <div>
                      <div className="text-sm font-semibold tracking-[-0.01em]">Inbox preview</div>
                      <div className="mt-0.5 text-xs text-black/45">All conversations · 4 unread</div>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Encrypted
                    </div>
                  </div>
                  <div>
                    {[
                      { initials: 'XM', name: 'XMTP Team', preview: 'Welcome to your private inbox.', time: 'Now', accent: true },
                      { initials: 'VI', name: 'vitalik.eth', preview: 'The XMTP integration looks great.', time: '9:42' },
                      { initials: 'DP', name: 'deanpierce.eth', preview: 'Re: SMTP bridge progress', time: 'Yesterday' },
                      { initials: 'AL', name: 'alice.eth', preview: 'Have you tried the new theme?', time: 'Mon' },
                    ].map((thread) => (
                      <div key={thread.name} className="landing-preview-row grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-black/[0.07] px-5 py-4 last:border-0 sm:px-6 sm:py-5">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold ${thread.accent ? 'bg-[#6558e8] text-white' : 'bg-black/[0.055] text-black/60'}`}>{thread.initials}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{thread.name}</div>
                          <div className="mt-0.5 truncate text-xs text-black/48">{thread.preview}</div>
                        </div>
                        <div className="font-mono text-[10px] text-black/38">{thread.time}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-black/[0.07] bg-black/[0.025] px-5 py-3 text-[10px] text-black/40 sm:px-6">
                    <span>Powered by XMTP</span>
                    <span>0 trackers · 0 ads</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!xmtpClient) {
    return (
      <div className="min-h-dvh" style={{ background: 'var(--gradient-page)', color: 'var(--foreground)' }}>
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>xmtp.mx</h1>
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {xmtpLoading ? 'Binding this browser to your XMTP identity…' : xmtpError ? 'XMTP failed.' : 'Initializing XMTP…'}
          </p>
          <WalletConnectButton />
          {xmtpError ? <p className="max-w-md text-sm" style={{ color: 'var(--accent-error)' }}>{xmtpError}</p> : null}
          {xmtpError ? (
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-md)' }}
              onClick={() => void initializeXmtpClient()}
              disabled={!hasActiveWallet || !isWasmInitialized || xmtpLoading}
            >
              Try again
            </button>
          ) : null}
          <StartupStatusPanel
            xmtpEnv={xmtpEnv}
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
    <div className="app-frame min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex h-dvh max-w-[1480px] flex-col gap-3 p-2 sm:p-4 lg:p-5">
        <header className="header-glass flex flex-col gap-3 rounded-[18px] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-black text-white" style={{ background: 'var(--primary)' }}>
              XM
            </div>
            <div>
              <div className="text-base font-semibold tracking-[-0.025em]" style={{ color: 'var(--foreground)' }}>xmtp.mx</div>
              <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>Your private XMTP inbox</div>
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
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: 'var(--accent-success-subtle)', color: 'var(--accent-success)' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-online)' }} /> XMTP {xmtpEnv}
            </div>
            <ThemeToggle />
            <WalletConnectButton compact />
          </div>
        </header>


        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          <aside className="hidden w-[220px] shrink-0 flex-col gap-3 sm:flex">
            <div className="sidebar-glass rounded-[18px] p-3">
              <button
                type="button"
                className="btn-primary flex w-full items-center justify-center gap-2"
                onClick={() => setComposeOpen(true)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Compose
              </button>

              <div className="mt-4 space-y-1 text-sm font-semibold">
                <div className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5" style={{ color: 'var(--primary)', background: 'var(--primary-subtle)' }}>
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--primary)' }} /> Inbox</span>
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>{conversationList.length}</span>
                </div>
                <div className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--foreground-subtle)' }} /> Sent
                </div>
                <div className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--foreground-subtle)' }} /> Drafts
                </div>
              </div>
            </div>

            <div className="rounded-2xl border p-4 text-xs" style={{ background: 'var(--primary-subtle)', borderColor: 'transparent', color: 'var(--foreground-muted)' }}>
              <div className="font-semibold" style={{ color: 'var(--foreground)' }}>Private by design</div>
              <p className="mt-1 leading-relaxed">Messages are encrypted on XMTP. Your wallet is the account; this browser is the installation.</p>
            </div>
          </aside>


          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[18px] border p-2" style={{ background: 'var(--surface-glass)', borderColor: 'var(--border)' }}>
            <div className="flex flex-1 gap-3 overflow-hidden">
              <section className="w-full max-w-[440px] shrink-0 overflow-hidden rounded-[14px]" style={{ background: 'var(--card-bg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Inbox</div>
                      <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>{conversationList.length} conversations</div>
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
