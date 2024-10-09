'use client';

import React, { useState, useEffect } from 'react';
import { useClient, useConversations, useMessages, useSendMessage } from '@xmtp/react-sdk';
import { ContentTypeMetadata, CachedConversation } from '@xmtp/react-sdk';

// Import the WebAssembly module initialization function
import init from '@xmtp/user-preferences-bindings-wasm/web';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const XMTPWebmailClient: React.FC = () => {
  const [isWasmInitialized, setIsWasmInitialized] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<CachedConversation<ContentTypeMetadata> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const { client, initialize, isLoading, error } = useClient();
  const { conversations: xmtpConversations } = useConversations();
  const { messages: selectedMessages } = useMessages(selectedConversation as CachedConversation<ContentTypeMetadata>);
  const { sendMessage } = useSendMessage();

  const initializeWasm = async () => {
    try {
      await init();
      console.log('WebAssembly module initialized successfully');
      setIsWasmInitialized(true);
    } catch (error: unknown) {
      setWasmError(error instanceof Error ? error.message : 'Unknown error');
      console.error('Error initializing WebAssembly:', error);
    }
  };

  useEffect(() => {
    initializeWasm();
  }, []);

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const signer = window.ethereum;
        await initialize({ signer });
        setIsConnected(true);
        console.log('XMTP client initialized successfully');
      } catch (error) {
        console.error('Error connecting wallet or initializing XMTP client:', error);
      }
    } else {
      console.error('MetaMask is not installed');
    }
  };

  const handleSendMessage = async (content: string) => {
    if (selectedConversation && sendMessage) {
      try {
        await sendMessage(selectedConversation, content);
        console.log('Message sent successfully');
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  };

  if (wasmError) {
    return <div>Error initializing WebAssembly: {wasmError}</div>;
  }

  if (!isWasmInitialized) {
    return <div>Initializing WebAssembly...</div>;
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-2xl font-bold mb-4">XMTP Webmail Client</h1>
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={connectWallet}
          disabled={isLoading}
        >
          {isLoading ? 'Connecting...' : 'Connect Wallet'}
        </button>
        {error && <p className="text-red-500 mt-2">{error.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-2xl font-bold">XMTP Webmail Client</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-1/4 bg-gray-100 p-4 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-4">Conversations</h2>
          <ul>
            {xmtpConversations.map((conv) => (
              <li
                key={conv.topic}
                className={`cursor-pointer p-2 ${selectedConversation?.topic === conv.topic ? 'bg-blue-100' : ''}`}
                onClick={() => setSelectedConversation(conv)}
              >
                {conv.peerAddress}
              </li>
            ))}
          </ul>
        </aside>
        <main className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            {selectedMessages.map((message) => (
              <div key={message.id} className="mb-2">
                <strong>{message.senderAddress}: </strong>
                {message.content}
              </div>
            ))}
          </div>
          <div className="p-4 border-t">
            <input
              type="text"
              className="w-full p-2 border rounded"
              placeholder="Type a message..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default XMTPWebmailClient;
