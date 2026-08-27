'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { shortenAddress } from '@/lib/xmtpAddressing';

export function WalletConnectButton({ compact = false }: { compact?: boolean }) {
  const { address, connector, isConnected } = useAccount();
  const { connectors, connectAsync, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  const walletOptions = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((candidate) => {
      const key = `${candidate.id}:${candidate.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectors]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (isConnected && address) {
    return (
      <button
        type="button"
        className="btn-nav whitespace-nowrap"
        onClick={() => disconnect()}
        aria-label={`Disconnect ${address}`}
        title={`Connected with ${connector?.name ?? 'wallet'}`}
      >
        {compact ? shortenAddress(address) : `${shortenAddress(address)} · Disconnect`}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-nav whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        Connect wallet
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60"
            aria-label="Close wallet choices"
            onClick={() => setOpen(false)}
          />
          <div
            className="modal-glass relative z-10 w-full max-w-sm rounded-2xl p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            data-testid="wallet-dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="wallet-dialog-title" className="text-lg font-semibold">Connect your wallet</h2>
                <p className="mt-1 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  Your wallet signs XMTP identity updates directly. xmtp.mx never receives your key.
                </p>
              </div>
              <button type="button" className="btn-nav" aria-label="Close wallet choices" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="mt-4 grid gap-2">
              {walletOptions.map((wallet) => (
                <button
                  type="button"
                  key={`${wallet.id}:${wallet.name}`}
                  className="btn-nav flex w-full items-center justify-between px-4 py-3 text-left"
                  disabled={isPending}
                  onClick={async () => {
                    try {
                      await connectAsync({ connector: wallet });
                      setOpen(false);
                    } catch {
                      // Wagmi exposes the connector error below.
                    }
                  }}
                >
                  <span className="font-semibold">{wallet.name}</span>
                  <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    {isPending ? 'Opening…' : 'Connect'}
                  </span>
                </button>
              ))}
            </div>

            {error ? <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--accent-error)' }}>{error.message}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
