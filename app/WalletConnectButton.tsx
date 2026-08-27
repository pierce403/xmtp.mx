'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { shortenAddress } from '@/lib/xmtpAddressing';

export function WalletConnectButton({
  compact = false,
  prominent = false,
}: {
  compact?: boolean;
  prominent?: boolean;
}) {
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
        className={`${prominent ? 'btn-primary' : 'btn-nav'} whitespace-nowrap`}
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
        className={`${prominent ? 'btn-primary' : 'btn-nav'} whitespace-nowrap`}
        onClick={() => setOpen(true)}
      >
        Connect wallet
        {prominent ? (
          <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        ) : null}
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
            className="modal-glass relative z-10 w-full max-w-md rounded-3xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            data-testid="wallet-dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M3 7.5A2.5 2.5 0 015.5 5h13A2.5 2.5 0 0121 7.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 16.5v-9z" />
                    <path d="M16 10h5v4h-5a2 2 0 010-4z" />
                  </svg>
                </div>
                <div>
                  <h2 id="wallet-dialog-title" className="text-lg font-semibold tracking-[-0.02em]">Connect your wallet</h2>
                  <p className="mt-1 max-w-xs text-sm leading-relaxed" style={{ color: 'var(--foreground-muted)' }}>
                    Your wallet signs XMTP identity updates directly. xmtp.mx never receives your key.
                  </p>
                </div>
              </div>
              <button type="button" className="btn-nav h-9 w-9 shrink-0 p-0" aria-label="Close wallet choices" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="mt-6 grid gap-2">
              {walletOptions.map((wallet) => (
                <button
                  type="button"
                  key={`${wallet.id}:${wallet.name}`}
                  className="btn-nav flex min-h-12 w-full items-center justify-between px-4 py-3 text-left"
                  aria-label={`${wallet.name} Connect`}
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
                  <span className="flex items-center gap-3 font-semibold">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg text-xs" style={{ background: 'var(--background-subtle)', color: 'var(--primary)' }}>↗</span>
                    {wallet.name}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    {isPending ? 'Opening…' : 'Connect'}
                  </span>
                </button>
              ))}
            </div>

            {error ? <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--accent-error)' }}>{error.message}</p> : null}
            <p className="mt-5 border-t pt-4 text-xs leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--foreground-subtle)' }}>
              No email, password, or custody. Your wallet address is your XMTP identity.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
