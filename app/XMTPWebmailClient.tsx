'use client';

import React, { useState, useEffect } from 'react';
import { useClient, useConversations, useMessages, useSendMessage } from '@xmtp/react-sdk';
import { ContentTypeMetadata, CachedConversation } from '@xmtp/react-sdk';

const XMTPWebmailClient: React.FC = () => {
  const [conversations, setConversations] = useState<CachedConversation<ContentTypeMetadata>[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<CachedConversation<ContentTypeMetadata> | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const { client, initialize } = useClient();
  const { conversations: xmtpConversations } = useConversations();
  const { messages } = useMessages(selectedConversation as CachedConversation<ContentTypeMetadata>);
  const { sendMessage } = useSendMessage();

  useEffect(() => {
    const initializeWasm = async () => {
      try {
        const wasmModule = await import('@xmtp/user-preferences-bindings-wasm');
        console.log('WebAssembly module imported:', wasmModule);
        await initialize({});
        console.log('XMTP client initialized successfully');
      } catch (error) {
        console.error('Error initializing WebAssembly module or XMTP client:', error);
      }
    };

    initializeWasm();
  }, [initialize]);

  useEffect(() => {
    if (xmtpConversations) {
      setConversations(xmtpConversations);
    }
  }, [xmtpConversations]);

  const handleSendMessage = async () => {
    if (selectedConversation && newMessage.trim() !== '') {
      try {
        await sendMessage(selectedConversation, newMessage);
        setNewMessage('');
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-gray-800 text-white p-4">
        <h1 className="text-2xl font-bold">XMTP Webmail Client</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-1/4 bg-gray-100 p-4 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-4">Conversations</h2>
          <ul>
            {conversations.map((conversation) => (
              <li
                key={conversation.topic}
                className={`cursor-pointer p-2 hover:bg-gray-200 ${
                  selectedConversation?.topic === conversation.topic ? 'bg-gray-300' : ''
                }`}
                onClick={() => setSelectedConversation(conversation)}
              >
                {conversation.peerAddress}
              </li>
            ))}
          </ul>
        </aside>
        <main className="flex-1 flex flex-col p-4">
          <div className="flex-1 overflow-y-auto mb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`mb-2 p-2 rounded ${
                  message.senderAddress === client?.address ? 'bg-blue-100 ml-auto' : 'bg-gray-100'
                }`}
              >
                <p>{message.content}</p>
                <small className="text-gray-500">
                  {new Date(message.sentAt).toLocaleString()}
                </small>
              </div>
            ))}
          </div>
          <div className="flex">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1 border p-2 mr-2"
              placeholder="Type your message..."
            />
            <button
              onClick={handleSendMessage}
              className="bg-blue-500 text-white px-4 py-2 rounded"
            >
              Send
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default XMTPWebmailClient;
