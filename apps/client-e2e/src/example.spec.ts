import { test, expect } from '@playwright/test';

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Chevras Mishnayos');
});
