// The app's dropdowns (React Aria Select, and the With list), driven like a user: open the button,
// pick from the listbox. Each button's accessible name is its value, then its label.
import { expect, type Locator, type Page } from "@playwright/test";

/** A dropdown's button, by its value then the label it ends with (case matters: "Playlist" isn't "Recap playlist"). */
export const dropdown = (scope: Page | Locator, label: string): Locator =>
  scope.getByRole("button", { name: new RegExp(`^.+ ${label}$`) });

/** The "with teammate" dropdown's button. */
export const withButton = (scope: Page | Locator): Locator => dropdown(scope, "With");

/** The open list's options. */
export const options = (page: Page): Locator => page.getByRole("listbox").getByRole("option");

/** One option of the open list, by its name (a greyed friend's reason is its description, not its name). */
export const option = (page: Page, name: string): Locator => page.getByRole("listbox").getByRole("option", { name, exact: true });

/** Opens the single-choice dropdown labelled `label`, picks `name`, and waits out the list's exit, so a next pick finds one list. */
export async function pick(page: Page, label: string, name: string): Promise<void> {
  await dropdown(page, label).click();
  await option(page, name).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
