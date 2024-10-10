import React from 'react';
import dynamic from 'next/dynamic';

const XMTPWebmailClient = dynamic(() => import('./XMTPWebmailClient'), { ssr: false });

const Home: React.FC = () => {
  return (
    <main>
      <XMTPWebmailClient />
    </main>
  );
};

export default Home;
