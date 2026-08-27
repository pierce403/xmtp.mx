import { createConfig, fallback, http } from '@wagmi/core';
import { base, baseSepolia, mainnet } from '@wagmi/core/chains';
import { coinbaseWallet, injected, metaMask, walletConnect } from '@wagmi/connectors';

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  'de49d3fcfa0a614710c571a3484a4d0f';

export const walletChains = [mainnet, base, baseSepolia] as const;

export const wagmiConfig = createConfig({
  chains: walletChains,
  connectors: [
    injected(),
    metaMask({
      dappMetadata: {
        name: 'xmtp.mx',
        url: 'https://xmtp.mx',
        iconUrl: 'https://xmtp.mx/favicon.ico',
      },
    }),
    coinbaseWallet({
      appName: 'xmtp.mx',
      preference: { options: 'all', telemetry: false },
    }),
    walletConnect({
      projectId: walletConnectProjectId,
      metadata: {
        name: 'xmtp.mx',
        description: 'A familiar inbox for encrypted XMTP messages',
        url: 'https://xmtp.mx',
        icons: ['https://xmtp.mx/favicon.ico'],
      },
      showQrModal: true,
    }),
  ],
  transports: {
    [mainnet.id]: fallback([
      http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL || 'https://cloudflare-eth.com'),
      http('https://ethereum-rpc.publicnode.com'),
    ]),
    [base.id]: fallback([
      http('https://mainnet.base.org'),
      http('https://base-rpc.publicnode.com'),
    ]),
    [baseSepolia.id]: fallback([
      http('https://sepolia.base.org'),
      http('https://base-sepolia-rpc.publicnode.com'),
    ]),
  },
  ssr: true,
});
