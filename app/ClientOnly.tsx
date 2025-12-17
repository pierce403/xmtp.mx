'use client';

import dynamic from 'next/dynamic';

const XMTPWebmailClient = dynamic(() => import('./XMTPWebmailClient'), {
  ssr: false,
});

export default function ClientOnly() {
  return <XMTPWebmailClient />;
}

