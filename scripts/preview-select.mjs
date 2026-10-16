export async function selectPreview(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("listbox", { name: `${label}选项`, exact: true })
    .locator(`[role="option"][data-value="${value}"]`)
    .click();
}
