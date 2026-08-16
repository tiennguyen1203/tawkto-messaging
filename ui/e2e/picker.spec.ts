import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * The picker, driven end to end against the running stack, with a screenshot at
 * each state worth looking at.
 *
 * The screenshots are the deliverable: they land outside the UI package, in
 * `docs/ui-review/screenshots/`, where the review page picks them up.
 */
const SHOTS = join(process.cwd(), '..', 'docs', 'ui-review', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const shoot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

/**
 * Reduced motion, so no screenshot catches a transition half way through. Set per
 * page rather than in the config: `reducedMotion` is not among the `use` options
 * this version of Playwright declares, and a config that only typechecks because
 * the file is excluded is a config nobody is checking.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Unique per run: the stack keeps what previous runs created. */
const stamp = () => String(Date.now()).slice(-6);

test.describe('the picker', () => {
  test('walks from no tenant to a held token', async ({ page }) => {
    const suffix = stamp();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Messaging demo' })).toBeVisible();
    // Waiting on the select rather than a timeout: it only renders once the tenant
    // request has come back, which is also what makes the screenshot deterministic.
    await expect(page.getByLabel('Act inside')).toBeVisible();
    await shoot(page, '01-picker-initial');

    await page.getByLabel('New tenant').fill(`Screenshot Co ${suffix}`);
    await page.getByRole('button', { name: 'Create tenant' }).click();

    // Creating selects it, and the empty user list is the state that tells a
    // reviewer what to do next — worth a picture of its own.
    await expect(page.getByText('This tenant has no users.')).toBeVisible();
    await shoot(page, '02-tenant-created-no-users');

    await page.getByLabel('Display name').fill('Alice');
    await page.getByLabel('Email').fill(`alice-${suffix}@acme.test`);
    await page.getByRole('button', { name: 'Create user' }).click();

    await expect(page.getByLabel('Act as')).toHaveValue(/.+/);
    await shoot(page, '03-user-selected');

    await page.getByRole('button', { name: 'Issue token' }).click();

    await expect(page.getByText('token: held')).toBeVisible();
    await expect(page.getByText('Bearer')).toBeVisible();
    await shoot(page, '04-token-issued');

    // Masked until asked for: the screenshot above must not contain the token, and
    // this one shows it does become readable.
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('code')).toContainText('eyJ');
    await shoot(page, '05-token-revealed');

    // In memory only. A reload is the demonstration of that, not a footnote.
    await page.reload();
    await expect(page.getByText('token: none')).toBeVisible();
    await shoot(page, '06-after-reload-token-gone');
  });

  test('shows the failure state when identity is unreachable', async ({ page }) => {
    // Nobody clicks through this state by hand, which is exactly why it is the one
    // that ships broken. Failing the request in the browser is the only way to see
    // it without breaking the stack.
    await page.route('**/for-demo/tenants*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Identity is unreachable', statusCode: 503 }),
      }),
    );

    await page.goto('/');

    await expect(page.getByRole('alert')).toContainText('Identity is unreachable');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await shoot(page, '07-tenants-failed');
  });

  test('renders in dark mode as well as light', async ({ page }) => {
    // Both explicitly. Playwright's own default is light, so the first version of
    // this test shot the light picker twice and produced two byte-identical files
    // while claiming to have covered both themes.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.getByLabel('Act inside')).toBeVisible();
    await shoot(page, '08-picker-light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await shoot(page, '09-picker-dark');

    await page.goto('/health');
    await expect(page.getByText('mongodb')).toBeVisible();
    await shoot(page, '10-health-dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await shoot(page, '11-health-light');
  });

  test('stays usable at a phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto('/');
    await expect(page.getByLabel('Act inside')).toBeVisible();

    // The check behind the picture: nothing may overflow sideways. A layout that
    // scrolls horizontally on a phone is the most common way a dense form breaks.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);

    await shoot(page, '12-picker-narrow');
  });
});
