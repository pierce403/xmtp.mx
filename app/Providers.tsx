'use client';

import type { ReactNode } from 'react';
import { ThirdwebProvider } from 'thirdweb/react';

export default function Providers({ children }: { children: ReactNode }) {
  return <ThirdwebProvider>{children}</ThirdwebProvider>;
}

