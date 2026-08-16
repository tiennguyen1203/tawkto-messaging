import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * The messenger, driven end to end: switch identity from the header, start a chat,
 * post into it, page back through it, search it, and be refused as the two callers
 * the API must refuse.
 *
 * One test for the walkthrough. Every part of it needs the same expensive setup —
 * a tenant, two people, a conversation, enough messages to page — and splitting it
 * would mean building that five times against one shared stack.
 */
const SHOTS = join(process.cwd(), '..', 'docs', 'ui-review', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const shoot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/**
 * Picks an option by the text it shows. `selectOption({ label })` takes an exact
 * string and these labels carry a generated email, so matching the visible name and
 * reading the option's value is both shorter and less brittle than rebuilding the
 * label the component composed.
 */
const choose = async (page: Page, field: string, text: string): Promise<void> => {
  const select = page.getByLabel(field, { exact: true });
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  await select.selectOption(value ?? '');
};

/**
 * Opens the switcher if it is not already open. Toggling blindly is how the first
 * version of this closed the panel it had just been left holding open.
 */
const openSwitcher = async (page: Page): Promise<void> => {
  const chip = page.locator('.chip');
  if ((await chip.getAttribute('aria-expanded')) !== 'true') {
    await chip.click();
  }
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
};

/**
 * The "Add" button belonging to a given field. Two forms in the panel have one, and
 * `.first()`/`.last()` picked whichever the DOM happened to offer — which failed
 * against a disabled button while the enabled one sat right there.
 */
const addBeside = (page: Page, field: string) =>
  page
    .locator('form', { has: page.getByLabel(field, { exact: true }) })
    .getByRole('button', { name: 'Add' });

/** The header switcher: make a tenant, add people, become one of them. */
const signIn = async (page: Page, tenant: string, people: string[]): Promise<void> => {
  await openSwitcher(page);

  await page.getByLabel('New tenant').fill(tenant);
  await addBeside(page, 'New tenant').click();
  // Exact: "Tenant" is also a substring of "New tenant", and the loose form
  // matches both the select and the text field beside it.
  await expect(page.getByLabel('Tenant', { exact: true })).toHaveValue(/.+/);

  for (const person of people) {
    await page.getByLabel('New user').fill(person);
    await addBeside(page, 'New user').click();
    // Wait for this person specifically: "the select has a value" is already true
    // after the first one and would wait for nothing.
    await expect(page.getByLabel('Act as').locator('option', { hasText: person })).toHaveCount(1);
  }
};

/** Reopens the switcher and becomes somebody already in the tenant. */
const becomes = async (page: Page, person: string): Promise<void> => {
  await openSwitcher(page);
  await choose(page, 'Act as', person);
  // Choosing closes the panel; the chip is the confirmation that it took.
  await expect(page.locator('.chip')).toContainText(person);
  await expect(page.locator('.chip')).toHaveAttribute('aria-expanded', 'false');
};

test.describe('the messenger', () => {
  test('switches identity, chats, pages, searches and is refused', async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = String(Date.now()).slice(-6);

    await page.goto('/');
    await expect(page.getByText('Nobody is signed in')).toBeVisible();
    await shoot(page, '30-signed-out');

    await signIn(page, `Acme ${suffix}`, ['Alice', 'Bob']);
    await shoot(page, '31-switcher-open');

    await becomes(page, 'Alice');
    await expect(page.getByText('No chats yet.')).toBeVisible();
    await shoot(page, '32-no-chats');

    await choose(page, 'New chat with', 'Bob');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('No messages yet.')).toBeVisible();
    // The header names the person, not a fragment of their id. It showed the id
    // for a while: the page loaded its user list when the tenant changed, which is
    // before anybody has been added to it, and never refreshed.
    await expect(page.locator('.chat__head h2')).toHaveText('Bob');
    await shoot(page, '33-empty-chat');

    const lines = [
      'deployment is finished',
      'staging looks healthy',
      'the deployment took four minutes',
      'rolling restart done',
      'cache warmed',
      'error rate is flat',
      'closing the incident',
    ];
    for (const line of lines) {
      await page.getByLabel('Message', { exact: true }).fill(line);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    }

    // Five per page: the newest are on screen and the oldest is not, which is what
    // makes the cursor visible at all.
    await expect(page.getByText('closing the incident')).toBeVisible();
    await expect(page.getByText('deployment is finished')).toHaveCount(0);
    await shoot(page, '34-chat-first-page');

    await page.getByRole('button', { name: 'Load older' }).click();
    await expect(page.getByText('deployment is finished')).toBeVisible();
    await expect(page.getByText('Beginning of the conversation')).toBeVisible();
    await shoot(page, '35-chat-after-paging');

    // Search reads Elasticsearch, fed by change data capture: a message posted a
    // second ago is not there yet. Polling is honest; a fixed sleep is a guess.
    await page.getByLabel('Search this chat').fill('deployment');
    await expect(async () => {
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText('2 matches for “deployment”')).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await shoot(page, '36-search-results');

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText('closing the incident')).toBeVisible();

    await page.getByText('Prove the isolation rules').click();
    await page.getByRole('button', { name: 'Ask as another tenant' }).click();
    await expect(page.getByText('404 — as designed')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Ask as a non-participant in this tenant' }).click();
    await expect(page.getByText('403 — as designed')).toBeVisible({ timeout: 20_000 });
    await shoot(page, '37-isolation-proved');

    // The other side of the same conversation, which is the whole reason the
    // switcher is one click away.
    await becomes(page, 'Bob');
    await expect(page.getByRole('button', { name: /Alice/ })).toBeVisible();
    await page.getByRole('button', { name: /Alice/ }).click();
    await expect(page.getByText('closing the incident')).toBeVisible();
    await shoot(page, '38-as-the-other-person');

    await page.getByLabel('Message', { exact: true }).fill('acknowledged, thanks');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('acknowledged, thanks')).toBeVisible();
    await shoot(page, '39-reply-from-bob');
  });

  test('shows the chat in dark mode and at a phone width', async ({ page }) => {
    const suffix = String(Date.now()).slice(-6);

    await page.goto('/');
    await signIn(page, `Themed ${suffix}`, ['Dana', 'Eli']);
    await becomes(page, 'Dana');
    await choose(page, 'New chat with', 'Eli');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByLabel('Message', { exact: true }).fill('does this look right in the dark?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('does this look right in the dark?')).toBeVisible();

    await page.emulateMedia({ colorScheme: 'light' });
    await shoot(page, '40-messenger-light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await shoot(page, '41-messenger-dark');

    await page.setViewportSize({ width: 390, height: 800 });
    // The rail stacks above the thread rather than squeezing beside it; nothing
    // may scroll sideways.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
    await shoot(page, '42-messenger-narrow');
  });
});
