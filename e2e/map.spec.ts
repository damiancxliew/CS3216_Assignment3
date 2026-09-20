import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('initial POC renders heading, disclosure, canvas, entities, and empty objectives', async ({ page }) => {
  await expect(page.locator('#adventure-title')).toBeVisible();
  await expect(page.getByText('Authored simulation').first()).toBeVisible();
  await expect(page.locator('#game-map')).toBeVisible();
  await expect(page.locator('[data-entity-type="npc"]')).toHaveCount(2);
  await expect(page.locator('[data-entity-type="evidence"]')).toHaveCount(1);
  await expect(page.locator('[data-entity-type="decision"]')).toHaveCount(1);
  await expect(page.locator('#objective-count')).toHaveText('0/3');
});

test('accessible interaction list completes the investigation and the choice persists', async ({ page }) => {
  for (const entityId of ['shortage-notice', 'mara-venn', 'elias-reed']) {
    await page.locator(`[data-entity-id="${entityId}"]`).click();
  }

  await expect(page.locator('#objective-count')).toHaveText('3/3');
  await expect(page.locator('#journal-count')).toHaveText('3');
  for (const entityId of ['shortage-notice', 'mara-venn', 'elias-reed']) {
    await expect(page.locator(`[data-entity-id="${entityId}"]`)).toHaveAttribute('data-visited', 'true');
  }

  const option = page.locator('[data-option-id="publish-and-review"]');
  await expect(option).toBeEnabled();
  await option.click();

  await expect(page.locator('#decision-status')).toContainText('Recommendation recorded');
  await expect(option).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('#decision-status')).toContainText('Recommendation recorded');
  await expect(page.locator('#objective-count')).toHaveText('3/3');
  await expect(page.locator('#journal-count')).toHaveText('3');
  await expect(page.locator('[data-option-id="publish-and-review"]')).toHaveAttribute('aria-pressed', 'true');
});

test('invalid blueprint import is rejected and the current world is retained', async ({ page }) => {
  const mapId = await page.locator('#map-id').textContent();
  await page.locator('#blueprint-json').fill('{}');
  await page.locator('#import-blueprint').click();
  await expect(page.locator('#map-id')).toHaveText(mapId ?? '');
  await expect(page.locator('#status')).toContainText('Import failed');
  await expect(page.locator('#status')).toContainText('current world was retained');
});

test('seed regeneration changes the map id and resets progress', async ({ page }) => {
  const mapId = await page.locator('#map-id').textContent();
  await page.locator('#seed-input').fill('proof-seed-2');
  await page.locator('#generate-map').click();
  await expect(page.locator('#map-id')).not.toHaveText(mapId ?? '');
  await expect(page.locator('[data-entity-type="npc"]')).toHaveCount(2);
  await expect(page.locator('[data-entity-type="evidence"]')).toHaveCount(1);
  await expect(page.locator('[data-entity-type="decision"]')).toHaveCount(1);
  await expect(page.locator('#objective-count')).toHaveText('0/3');
});
