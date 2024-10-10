"use client";

import React, { useState, useEffect } from 'react';
import { Client } from '@xmtp/xmtp-js';
import { ethers } from 'ethers';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string }) => Promise<string[]>;
    } & ethers.Eip1193Provider;
  }
}

const XMTPWebmailClient: React.FC = () => {
  const [client, setClient] = useState<Client | null>(null);
  const [wasmError, setWasmError] = useState<string | null>(null);

  useEffect(() => {
    const initializeWasm = async () => {
      try {
        console.log('Starting WebAssembly initialization');

        // Dynamically import the WebAssembly module
        const wasmModule = await import('@xmtp/user-preferences-bindings-wasm/web');
        console.log('WebAssembly module imported:', wasmModule);

        // Check if the default export is a function (the initializer)
        if (typeof wasmModule.default === 'function') {
          console.log('WebAssembly module default export is a function');

          // Create a custom URL class to handle relative paths
          class CustomURL extends URL {
            constructor(url: string | URL, base?: string | URL) {
              console.log('CustomURL constructor called with:', { url, base });
              let finalUrl: string | URL;
              if (typeof url === 'string') {
                if (url.startsWith('./')) {
                  finalUrl = new URL(url.slice(2), base || window.location.href).href;
                } else if (url === '') {
                  finalUrl = base ? new URL(base) : new URL(window.location.href);
                } else {
                  finalUrl = url;
                }
              } else {
                finalUrl = url;
              }
              super(finalUrl);
            }
          }

          // Replace the global URL with our custom implementation
          const originalURL = global.URL;
          global.URL = CustomURL as any;
          console.log('Global URL replaced with CustomURL');

          try {
            // Initialize the WebAssembly module
            console.log('Initializing WebAssembly module');
            await wasmModule.default();
            console.log('WebAssembly module initialized successfully');
          } catch (initError) {
            console.error('Error during WebAssembly module initialization:', initError);
            setWasmError(`WebAssembly initialization error: ${initError instanceof Error ? initError.message : 'Unknown error'}`);
          } finally {
            // Restore the original URL implementation
            global.URL = originalURL;
            console.log('Original URL implementation restored');
          }
        } else {
          console.error('WebAssembly module default export is not a function');
          setWasmError('Failed to initialize WebAssembly module: default export is not a function');
        }
      } catch (error) {
        console.error('Error in initializeWasm:', error);
        setWasmError(error instanceof Error ? error.message : 'Unknown error during WebAssembly initialization');
      }
    };

    initializeWasm();
  }, []);

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const xmtp = await Client.create(signer, { env: 'production' });
        setClient(xmtp);
      } catch (error) {
        console.error('Failed to connect wallet:', error);
      }
    } else {
      console.error('MetaMask is not installed');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">XMTP Webmail Client</h1>
      {wasmError ? (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error:</strong>
          <span className="block sm:inline"> {wasmError}</span>
        </div>
      ) : client ? (
        <div>
          <p>Connected to XMTP</p>
          {/* Add more UI components for the webmail client here */}
        </div>
      ) : (
        <button
          onClick={connectWallet}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Connect Wallet
        </button>
      )}
    </div>
  );
};

export default XMTPWebmailClient;
