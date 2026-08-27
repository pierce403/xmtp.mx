'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { signMessage as signMessageWithConnector, type Connector } from '@wagmi/core';
import { useAccount, useConnect, useConnectors, useDisconnect, useSignMessage } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmiConfig';
import {
  clearWalletConnectionIntent,
  createWalletConnectionIntent,
  persistWalletConnectionIntent,
  readWalletConnectionIntent,
  type WalletConnectionIntent,
} from '@/lib/walletConnectionIntent';

type WalletConnectionResult = {
  accounts: readonly `0x${string}`[];
  chainId?: number;
};

type RecoveredWallet = {
  address: `0x${string}`;
  chainId?: number;
  connector: Connector;
};

type WalletSessionValue = {
  address?: `0x${string}`;
  chainId?: number;
  connector?: Connector;
  connectors: readonly Connector[];
  isConnected: boolean;
  pendingConnectorUid: string | null;
  connectWallet: (connector: Connector) => Promise<WalletConnectionResult>;
  disconnectWallet: () => Promise<void>;
  signMessage: (message: string, account: `0x${string}`) => Promise<`0x${string}`>;
};

const WalletSessionContext = createContext<WalletSessionValue | null>(null);
const walletReturnProbeDelays = [0, 250, 750, 1_500, 2_500] as const;
const walletProbeTimeoutMs = 2_000;

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

async function withWalletProbeTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Wallet session probe timed out.')), walletProbeTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function probeWalletConnector(connector: Connector): Promise<WalletConnectionResult | undefined> {
  try {
    const accounts = await withWalletProbeTimeout(connector.getAccounts());
    if (!accounts[0]) return undefined;
    const chainId = await withWalletProbeTimeout(connector.getChainId()).catch(() => undefined);
    return { accounts, chainId };
  } catch {
    return undefined;
  }
}

function isWalletConnectionCancellation(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 4001) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user cancelled') ||
    message.includes('user canceled')
  );
}

function waitForWalletConnectorReturn(connector: Connector) {
  let finished = false;
  let resolveRecovered: (result: WalletConnectionResult) => void = () => undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const promise = new Promise<WalletConnectionResult>((resolve) => {
    resolveRecovered = resolve;
  });

  const recover = (result: WalletConnectionResult | undefined) => {
    if (finished || !result?.accounts[0]) return;
    finished = true;
    resolveRecovered(result);
  };
  const probe = () => void probeWalletConnector(connector).then(recover);
  const scheduleProbes = () => {
    if (finished) return;
    for (const timer of timers) clearTimeout(timer);
    timers = walletReturnProbeDelays.map((delayMs) => setTimeout(probe, delayMs));
  };
  const onConnect = (event: { accounts: readonly `0x${string}`[]; chainId: number }) => recover(event);
  const onChange = (event: { accounts?: readonly `0x${string}`[]; chainId?: number }) => {
    if (event.accounts?.[0]) recover({ accounts: event.accounts, chainId: event.chainId });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') scheduleProbes();
  };

  connector.emitter.on('connect', onConnect);
  connector.emitter.on('change', onChange);
  window.addEventListener('pageshow', scheduleProbes);
  window.addEventListener('focus', scheduleProbes);
  document.addEventListener('visibilitychange', onVisibilityChange);
  scheduleProbes();

  return {
    promise,
    cleanup: () => {
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      connector.emitter.off('connect', onConnect);
      connector.emitter.off('change', onChange);
      window.removeEventListener('pageshow', scheduleProbes);
      window.removeEventListener('focus', scheduleProbes);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [recoveredWallet, setRecoveredWallet] = useState<RecoveredWallet | null>(null);
  const [pendingIntent, setPendingIntent] = useState<WalletConnectionIntent | null>(() =>
    readWalletConnectionIntent(),
  );
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(null);
  const resumePromiseRef = useRef<Promise<WalletConnectionResult | undefined> | null>(null);

  const acceptConnection = useCallback((connector: Connector, result: WalletConnectionResult) => {
    const address = result.accounts[0];
    if (!address) throw new Error('The wallet connected without exposing an account.');
    setRecoveredWallet({ address, chainId: result.chainId, connector });
    return result;
  }, []);

  const connectWallet = useCallback(
    async (connector: Connector) => {
      const intent = createWalletConnectionIntent(connector.id, connector.name);
      persistWalletConnectionIntent(intent);
      setPendingIntent(intent);
      setPendingConnectorUid(connector.uid);

      const recovery = waitForWalletConnectorReturn(connector);
      const connectorOutcome = connectAsync({ connector }).then(
        (result) => ({ type: 'connected' as const, result }),
        (error: unknown) => ({ type: 'error' as const, error }),
      );

      try {
        const outcome = await Promise.race([
          connectorOutcome,
          recovery.promise.then((result) => ({ type: 'connected' as const, result })),
        ]);
        if (outcome.type === 'error') {
          if (isWalletConnectionCancellation(outcome.error)) {
            clearWalletConnectionIntent(intent.attemptId);
            setPendingIntent(null);
          }
          throw outcome.error;
        }
        return acceptConnection(connector, outcome.result);
      } finally {
        recovery.cleanup();
        setPendingConnectorUid((current) => (current === connector.uid ? null : current));
      }
    },
    [acceptConnection, connectAsync],
  );

  const resumePendingConnection = useCallback(async () => {
    const intent = readWalletConnectionIntent();
    setPendingIntent(intent);
    if (!intent || account.address) return undefined;
    if (resumePromiseRef.current) return await resumePromiseRef.current;

    const connector = connectors.find(
      (candidate) => candidate.id === intent.connectorId && candidate.name === intent.connectorName,
    );
    if (!connector) return undefined;

    const promise = (async () => {
      setPendingConnectorUid(connector.uid);
      for (const delayMs of walletReturnProbeDelays) {
        if (delayMs) await wait(delayMs);
        const current = readWalletConnectionIntent();
        if (!current || current.attemptId !== intent.attemptId) return undefined;
        if (document.visibilityState === 'hidden') return undefined;
        const result = await probeWalletConnector(connector);
        if (result?.accounts[0]) return acceptConnection(connector, result);
      }
      return undefined;
    })();

    resumePromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (resumePromiseRef.current === promise) resumePromiseRef.current = null;
      setPendingConnectorUid((current) => (current === connector.uid ? null : current));
    }
  }, [acceptConnection, account.address, connectors]);

  useEffect(() => {
    void resumePendingConnection();
    const onReturn = () => void resumePendingConnection();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') void resumePendingConnection();
    };
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', onReturn);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [resumePendingConnection]);

  useEffect(() => {
    if (!account.address || !pendingIntent) return;
    clearWalletConnectionIntent(pendingIntent.attemptId);
    setPendingIntent(null);
  }, [account.address, pendingIntent]);

  const disconnectWallet = useCallback(async () => {
    const recoveredConnector = recoveredWallet?.connector;
    clearWalletConnectionIntent();
    setPendingIntent(null);
    setPendingConnectorUid(null);
    setRecoveredWallet(null);
    if (account.address) {
      await disconnectAsync();
    } else if (recoveredConnector) {
      await recoveredConnector.disconnect();
    }
  }, [account.address, disconnectAsync, recoveredWallet?.connector]);

  const signMessage = useCallback(
    async (message: string, address: `0x${string}`) => {
      if (recoveredWallet) {
        const activeAccounts = await recoveredWallet.connector.getAccounts();
        if (!activeAccounts.some((activeAddress) => activeAddress.toLowerCase() === address.toLowerCase())) {
          throw new Error('The selected wallet account is no longer active. Reconnect it and try again.');
        }
        return await signMessageWithConnector(wagmiConfig, {
          connector: recoveredWallet.connector,
          account: address,
          message,
        });
      }
      return await signMessageAsync({ message, account: address });
    },
    [recoveredWallet, signMessageAsync],
  );

  const address = account.address ?? recoveredWallet?.address;
  const chainId = account.chainId ?? recoveredWallet?.chainId;
  const connector = account.connector ?? recoveredWallet?.connector;
  const value = useMemo<WalletSessionValue>(
    () => ({
      address,
      chainId,
      connector,
      connectors,
      isConnected: Boolean(address),
      pendingConnectorUid,
      connectWallet,
      disconnectWallet,
      signMessage,
    }),
    [address, chainId, connectWallet, connector, connectors, disconnectWallet, pendingConnectorUid, signMessage],
  );

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSession() {
  const context = useContext(WalletSessionContext);
  if (!context) throw new Error('useWalletSession must be used inside WalletSessionProvider.');
  return context;
}
