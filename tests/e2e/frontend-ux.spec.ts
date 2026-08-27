import { expect, test } from '@playwright/test';

test('an injected wallet binds to the app account and can disconnect', async ({ page }) => {
  const address = '0x1111111111111111111111111111111111111111';
  await page.addInitScript((walletAddress) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: false,
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [walletAddress];
          if (method === 'eth_chainId') return '0x1';
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'personal_sign') return `0x${'11'.repeat(65)}`;
          return null;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        },
      },
    });
  }, address);
  await page.route(/https:\/\/(cloudflare-eth\.com|ethereum-rpc\.publicnode\.com)\/.*/, async (route) => {
    const request = route.request().postDataJSON() as { id?: number; method?: string } | null;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request?.id ?? 1,
        result: request?.method === 'eth_getCode' ? '0x' : '0x1',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByTestId('wallet-dialog').getByRole('button', { name: /^Injected Connect$/ }).click();

  const disconnect = page.getByRole('button', { name: `Disconnect ${address}` });
  await expect(disconnect).toBeVisible();
  await disconnect.click();
  await expect(page.getByRole('heading', { name: 'Your wallet has an inbox.' })).toBeVisible();
});

test('landing explains the product and opens the demo', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your wallet has an inbox.' })).toBeVisible();
  await expect(page.getByText('Inbox preview')).toBeVisible();
  await expect(page.getByText('No wallet needed for demo')).toBeVisible();

  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const walletDialog = page.getByTestId('wallet-dialog');
  await expect(walletDialog).toBeVisible();
  await expect(walletDialog.getByText('Your wallet signs XMTP identity updates directly.')).toBeVisible();
  await walletDialog.getByRole('button', { name: 'Close wallet choices' }).click();
  await expect(walletDialog).toBeHidden();

  await page.getByRole('button', { name: 'Open demo inbox' }).click();

  await expect(page).toHaveURL(/\?demo=1$/);
  await expect(page.getByTestId('demo-mail-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit demo' })).toBeVisible();
});

test('demo navigation and search behave like a mail client', async ({ page }) => {
  await page.goto('/?demo=1');

  const mailbox = page.getByRole('navigation', { name: 'Demo mailbox' });
  await mailbox.getByRole('button', { name: /Sent/ }).click();
  await expect(page.getByText("Messages you've sent")).toBeVisible();

  await mailbox.getByRole('button', { name: /Contacts/ }).click();
  await expect(page.getByText("People you've messaged")).toBeVisible();

  await mailbox.getByRole('button', { name: /Inbox/ }).click();
  const search = page.getByRole('textbox', { name: 'Search demo inbox' });
  await search.fill('alice');
  await expect(page.getByRole('button', { name: /alice\.eth/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /vitalik\.eth/i })).toHaveCount(0);

  await search.fill('nothing will match this');
  await expect(page.getByText('No matching messages')).toBeVisible();
});

test('demo conversations and compose support keyboard-safe dismissal', async ({ page }) => {
  await page.goto('/?demo=1');

  await page.getByRole('button', { name: /vitalik\.eth/i }).click();
  const conversationDialog = page.getByTestId('demo-conversation-dialog');
  await expect(conversationDialog).toBeVisible();
  await expect(conversationDialog.getByText('Encrypted', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(conversationDialog).toBeHidden();

  await page.getByRole('button', { name: /Compose/ }).click();
  const composeDialog = page.getByTestId('demo-compose-dialog');
  await expect(composeDialog).toBeVisible();
  await composeDialog.getByRole('button', { name: 'Send' }).click();
  await expect(composeDialog.getByRole('alert')).toContainText('Add an ENS name');

  await composeDialog.getByLabel('To').fill('alice.eth');
  await composeDialog.getByLabel('Message').fill('Want to try xmtp.mx?');
  await composeDialog.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Demo message prepared for alice.eth');

  await page.getByRole('button', { name: /Compose/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('demo-compose-dialog')).toBeHidden();
});

test('demo stays inside the viewport and can return to the landing page', async ({ page }) => {
  await page.goto('/?demo=1');

  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: /XMTP Team/ }).click();
  const mailListBox = await page.getByTestId('demo-mail-list').boundingBox();
  const dialogBox = await page.getByTestId('demo-conversation-dialog').boundingBox();
  expect(mailListBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(mailListBox!.x);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(mailListBox!.y);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(mailListBox!.x + mailListBox!.width + 1);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(mailListBox!.y + mailListBox!.height + 1);

  await page.getByRole('button', { name: 'Close welcome thread' }).click();
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page).not.toHaveURL(/demo/);
  await expect(page.getByRole('heading', { name: 'Your wallet has an inbox.' })).toBeVisible();
});
