'use client'

import React, { useState, useCallback } from 'react';
import { useClient, useConversations, useMessages, XMTPProvider } from '@xmtp/react-sdk';
import { Conversation, DecodedMessage, Client } from '@xmtp/xmtp-js';
import { CachedConversation, CachedMessage, ContentTypeMetadata } from '@xmtp/react-sdk';
import { ethers } from 'ethers';

type ExtendedCachedConversation = CachedConversation<ContentTypeMetadata> & { send: (content: string) => Promise<void> };

// Add type definition for window.ethereum
declare global {
  interface Window {
    ethereum: any;
  }
}

// Add this type definition
type MockWallet = {
  address: string;
  signMessage: (message: string) => Promise<string>;
};

// Add this function to create a mock wallet
const createMockWallet = (): MockWallet => {
  const privateKey = ethers.utils.randomBytes(32);
  const wallet = new ethers.Wallet(privateKey);
  return {
    address: wallet.address,
    signMessage: (message: string) => wallet.signMessage(message),
  };
};

const XMTPWebmail: React.FC = () => {
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ExtendedCachedConversation | null>(null);
  const [composeMode, setComposeMode] = useState(false);
  const [newMessageAddress, setNewMessageAddress] = useState('');
  const [newMessageContent, setNewMessageContent] = useState('');
  const [useMockClient, setUseMockClient] = useState(false);

  const mockClient = {
    canMessage: async () => true,
    conversations: {
      newConversation: async (address: string) => ({
        send: async (content: string) => {
          console.log(`Mock: Sending message "${content}" to ${address}`);
        },
      }),
    },
  };

  const { client, initialize } = useClient();
  const { conversations } = useConversations();
  const { messages } = selectedConversation
    ? useMessages(selectedConversation as CachedConversation<ContentTypeMetadata>)
    : { messages: [] };

  const effectiveClient = useMockClient ? mockClient : client;
  const effectiveConversations = useMockClient ? [] : conversations;
  const effectiveMessages = useMockClient ? [] : messages;

  // Remove duplicate declarations

  const connectWallet = async () => {
    console.log('Connecting wallet...');
    try {
      if (useMockClient) {
        console.log('Using mock client');
        setSigner({} as ethers.Signer);
        await initialize({} as any);
        console.log('Mock client initialized');
      } else {
        let walletSigner: ethers.Signer;
        if (typeof window.ethereum !== 'undefined') {
          console.log('Using MetaMask');
          const provider = new ethers.providers.Web3Provider(window.ethereum);
          await provider.send('eth_requestAccounts', []);
          walletSigner = provider.getSigner();
        } else {
          console.log('MetaMask not detected, using mock wallet');
          const mockWallet = createMockWallet();
          walletSigner = new ethers.VoidSigner(mockWallet.address);
          (walletSigner as any).signMessage = mockWallet.signMessage;
        }
        setSigner(walletSigner);
        await initialize({ signer: walletSigner });
        console.log('Wallet connected and XMTP client initialized');
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      if (error instanceof Error) {
        alert(`Failed to connect wallet: ${error.message}. Please try again or refresh the page.`);
      } else {
        alert('An unknown error occurred while connecting the wallet. Please try again or refresh the page.');
      }
    }
  };

  const sendMessage = async (content: string) => {
    if (selectedConversation && client) {
      try {
        await selectedConversation.send(content);
        setNewMessageContent('');
      } catch (error) {
        console.error('Failed to send message:', error);
      }
    }
  };

  const startNewConversation = async () => {
    console.log('Starting new conversation...');
    if (effectiveClient && newMessageAddress && newMessageContent) {
      try {
        if (useMockClient) {
          console.log(`Mock: Starting new conversation with ${newMessageAddress}`);
          const conversation = await mockClient.conversations.newConversation(newMessageAddress);
          await conversation.send(newMessageContent);
          console.log('Mock: Message sent successfully!');
          setComposeMode(false);
          setNewMessageAddress('');
          setNewMessageContent('');
          alert('Mock: Message sent successfully!');
        } else {
          console.log(`Checking if address ${newMessageAddress} is on XMTP network...`);
          const isOnNetwork = await client.canMessage(newMessageAddress);
          if (!isOnNetwork) {
            console.log(`Address ${newMessageAddress} is not on the XMTP network.`);
            alert(`The address ${newMessageAddress} is not on the XMTP network. Please try a different address or use the mock client for testing.`);
            return;
          }
          console.log(`Address ${newMessageAddress} is on the XMTP network. Creating new conversation...`);
          const conversation = await client.conversations.newConversation(newMessageAddress);
          console.log('New conversation created. Sending message...');
          await conversation.send(newMessageContent);
          console.log('Message sent successfully!');
          setComposeMode(false);
          setNewMessageAddress('');
          setNewMessageContent('');
          alert('Message sent successfully!');
        }
      } catch (error) {
        console.error('Failed to start new conversation:', error);
        alert(`Failed to start new conversation: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or use the mock client for testing.`);
      }
    } else {
      console.log('Client, address, or message content is missing:', { effectiveClient, newMessageAddress, newMessageContent });
      alert('Please ensure you have connected your wallet, entered a recipient address, and provided a message content before sending.');
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r">
        <div className="p-4">
          <button
            onClick={connectWallet}
            className="w-full bg-blue-500 text-white py-2 rounded"
          >
            {signer ? 'Connected' : 'Connect Wallet'}
          </button>
        </div>
        <button
          onClick={() => setComposeMode(true)}
          className="w-full bg-red-500 text-white py-2 rounded mt-4"
        >
          Compose
        </button>
        <button
          onClick={() => setUseMockClient(!useMockClient)}
          className="w-full bg-green-500 text-white py-2 rounded mt-4"
        >
          {useMockClient ? 'Use Real Client' : 'Use Mock Client'}
        </button>
        <div className="overflow-y-auto h-full">
          {conversations.map((conversation: CachedConversation<ContentTypeMetadata>) => (
            <div
              key={conversation.topic}
              onClick={() => setSelectedConversation(conversation as ExtendedCachedConversation)}
              className="p-3 hover:bg-gray-100 cursor-pointer"
            >
              {conversation.peerAddress}
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b p-4">
          <h1 className="text-2xl font-bold">XMTP Webmail</h1>
        </div>

        {composeMode ? (
          <div className="flex-1 p-4">
            <input
              type="text"
              placeholder="To: (Ethereum address)"
              className="w-full p-2 border rounded mb-2"
              value={newMessageAddress}
              onChange={(e) => setNewMessageAddress(e.target.value)}
            />
            <textarea
              placeholder="Message content"
              className="w-full p-2 border rounded mb-2 h-40"
              value={newMessageContent}
              onChange={(e) => setNewMessageContent(e.target.value)}
            />
            <button
              onClick={startNewConversation}
              className="bg-blue-500 text-white py-2 px-4 rounded"
            >
              Send
            </button>
          </div>
        ) : (
          <>
            {selectedConversation ? (
              <>
                {/* Message list */}
                <div className="flex-1 overflow-y-auto p-4">
                  {messages.map((message: CachedMessage, index: number) => (
                    <div key={index} className="mb-4 p-2 bg-white rounded shadow">
                      <div className="font-bold">{message.senderAddress}</div>
                      <div className="text-gray-600 text-sm">{new Date(message.sentAt).toLocaleString()}</div>
                      <div className="mt-2">{message.content}</div>
                    </div>
                  ))}
                </div>

                {/* Compose message input */}
                <div className="p-4 border-t">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    className="w-full p-2 border rounded"
                    value={newMessageContent}
                    onChange={(e) => setNewMessageContent(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        sendMessage(newMessageContent);
                      }
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-500">Select a conversation or start a new one</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default function Home() {
  return (
    <XMTPProvider>
      <XMTPWebmail />
    </XMTPProvider>
  );
}
