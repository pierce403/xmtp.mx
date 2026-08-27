export const WALLET_CONNECTION_INTENT_STORAGE_KEY = 'xmtp.mx.wallet-connection-intent';
export const WALLET_CONNECTION_INTENT_TTL_MS = 15 * 60 * 1_000;

export type WalletConnectionIntent = {
  connectorId: string;
  connectorName: string;
  attemptId: string;
  createdAt: number;
};

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function isWalletConnectionIntent(value: unknown): value is WalletConnectionIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WalletConnectionIntent>;
  return (
    typeof candidate.connectorId === 'string' &&
    typeof candidate.connectorName === 'string' &&
    typeof candidate.attemptId === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

export function createWalletConnectionIntent(
  connectorId: string,
  connectorName: string,
): WalletConnectionIntent {
  return {
    connectorId,
    connectorName,
    attemptId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
  };
}

export function readWalletConnectionIntent(
  storage: Storage | null = browserStorage(),
  now = Date.now(),
): WalletConnectionIntent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const intent: unknown = JSON.parse(raw);
    if (
      !isWalletConnectionIntent(intent) ||
      intent.createdAt > now ||
      now - intent.createdAt > WALLET_CONNECTION_INTENT_TTL_MS
    ) {
      storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
      return null;
    }
    return intent;
  } catch {
    storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
    return null;
  }
}

export function persistWalletConnectionIntent(
  intent: WalletConnectionIntent,
  storage: Storage | null = browserStorage(),
) {
  storage?.setItem(WALLET_CONNECTION_INTENT_STORAGE_KEY, JSON.stringify(intent));
}

export function clearWalletConnectionIntent(
  attemptId?: string,
  storage: Storage | null = browserStorage(),
) {
  if (!storage) return;
  if (attemptId && readWalletConnectionIntent(storage)?.attemptId !== attemptId) return;
  storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
}
