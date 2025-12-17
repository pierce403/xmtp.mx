'use client';

import type { ReactNode } from 'react';
import { XMTPProvider } from '@xmtp/react-sdk';
import { ThirdwebProvider } from 'thirdweb/react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThirdwebProvider>
      <XMTPProvider>{children}</XMTPProvider>
    </ThirdwebProvider>
  );
}
