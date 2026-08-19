import { expect, test, type BrowserContext } from "@playwright/test";

const PASSWORD = "testpassword";
const stamp = () => Date.now().toString(36);

/** Registers a session user in the given browser context (in-place upgrade of the anon user). */
async function registerUser(
  context: BrowserContext,
  username: string,
  email: string,
): Promise<void> {
  const resp = await context.request.post("/register", {
    form: {
      username,
      password: PASSWORD,
      password_confirmation: PASSWORD,
      email,
    },
  });
  expect(resp.ok()).toBeTruthy();
}

/**
 * Creates an email-invite game through the UI as the context's logged-in
 * user and returns (game id, invite link, creator page). The page stays
 * open so the creator's live view can be asserted.
 */
async function createEmailInvite(
  context: BrowserContext,
  email: string,
  opts: { color?: string } = {},
): Promise<{
  gameId: number;
  inviteLink: string;
  page: import("@playwright/test").Page;
}> {
  const page = await context.newPage();
  await page.goto("/games/new");

  await page.getByText("Email invite", { exact: true }).click();
  if (opts.color) {
    // The color radios are visually hidden behind stone icons — click the label.
    await page.locator(`label[for="color_${opts.color}"]`).click();
  }
  await page.fill("#invite_email", email);

  const createResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/games" &&
      r.headers()["content-type"]?.includes("json"),
  );
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL(/\/games\/\d+/);

  const body = await (await createResponse).json();
  expect(body.invite_link).toBeTruthy();
  const gameId = Number(body.redirect.match(/\/games\/(\d+)/)![1]);
  return { gameId, inviteLink: body.invite_link as string, page };
}

test("email invite: anonymous recipient is logged in and accepts the challenge", async ({
  browser,
}) => {
  const creatorCtx = await browser.newContext();
  await registerUser(
    creatorCtx,
    `creator-${stamp()}`,
    `c-${stamp()}@example.com`,
  );

  const email = `invitee-${stamp()}@example.com`;
  const {
    gameId,
    inviteLink,
    page: creatorPage,
  } = await createEmailInvite(creatorCtx, email);

  // The creator waits for the opponent to respond.
  await expect(creatorPage.getByText(/Waiting for/i).first()).toBeVisible();

  // The challengee already exists with the email at mint time.
  const inviteeCtx = await browser.newContext();
  const page = await inviteeCtx.newPage();
  await page.goto(inviteLink);
  await page.waitForURL(new RegExp(`/games/${gameId}`));

  // Logged into the anonymous challengee session: the accept prompt shows.
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();

  // Challenge resolved: the board is up and it's black's turn.
  await expect(page.getByRole("button", { name: "Accept" })).toBeHidden();
  await expect(page.locator(".goban-container")).toBeVisible();
  await expect(page.getByText(/Your turn|to play/i).first()).toBeVisible();

  // The creator's live view updates: the game has started.
  await expect(
    creatorPage.getByText(/Your turn|to play/i).first(),
  ).toBeVisible();
});

test("email invite: nigiri game resolves colors on accept", async ({
  browser,
}) => {
  const creatorCtx = await browser.newContext();
  await registerUser(
    creatorCtx,
    `creator-${stamp()}`,
    `c-${stamp()}@example.com`,
  );

  const { inviteLink, page: creatorPage } = await createEmailInvite(
    creatorCtx,
    `invitee-${stamp()}@example.com`,
    { color: "nigiri" },
  );
  await expect(creatorPage.getByText(/Waiting for/i).first()).toBeVisible();

  // The invitee accepts; colors are decided by nigiri and the game starts.
  const inviteeCtx = await browser.newContext();
  const page = await inviteeCtx.newPage();
  await page.goto(inviteLink);
  await page.waitForURL(/\/games\/\d+/);
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();

  await expect(page.getByRole("button", { name: "Accept" })).toBeHidden();
  await expect(page.locator(".goban-container")).toBeVisible();
  await expect(page.getByText(/Your turn|to play/i).first()).toBeVisible();
  await expect(
    creatorPage.getByText(/Your turn|to play/i).first(),
  ).toBeVisible();
});

test("email invite: registered recipient is sent to login, then reaches the game", async ({
  browser,
}) => {
  const creatorCtx = await browser.newContext();
  await registerUser(
    creatorCtx,
    `creator-${stamp()}`,
    `c-${stamp()}@example.com`,
  );

  const recipientEmail = `r-${stamp()}@example.com`;
  const recipientName = `recipient-${stamp()}`;
  const recipientCtx = await browser.newContext();
  await registerUser(recipientCtx, recipientName, recipientEmail);
  await recipientCtx.close();

  const { gameId, inviteLink } = await createEmailInvite(
    creatorCtx,
    recipientEmail,
  );

  // Logged-out visitor is sent to the login page, pointed back at the game.
  const page = await (await browser.newContext()).newPage();
  await page.goto(inviteLink);
  await page.waitForURL(new RegExp(`/login\\?redirect=/games/${gameId}`));

  await page.fill('input[name="username"]', recipientName);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // Signed in as the challengee: the seat is theirs, accept the challenge.
  await page.waitForURL(new RegExp(`/games/${gameId}`));
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
});

test("email invite: token is single-use", async ({ browser }) => {
  const creatorCtx = await browser.newContext();
  await registerUser(
    creatorCtx,
    `creator-${stamp()}`,
    `c-${stamp()}@example.com`,
  );
  const { inviteLink } = await createEmailInvite(
    creatorCtx,
    `invitee-${stamp()}@example.com`,
  );

  // First visitor consumes the token.
  const firstCtx = await browser.newContext();
  const firstPage = await firstCtx.newPage();
  await firstPage.goto(inviteLink);
  await expect(firstPage).toHaveURL(/\/games\/\d+/);
  await firstCtx.close();

  // Second visitor gets a dead link: redirected home with an error flash.
  const secondCtx = await browser.newContext();
  const page = await secondCtx.newPage();
  await page.goto(inviteLink);
  await expect(page).toHaveURL("/");
  const alert = page.locator('[role="alert"]');
  await expect(alert).toContainText(/invalid or has expired/i);
  // The flash must survive the async auth resolution (~2s) — it used to be
  // cleared the moment auth finished.
  await page.waitForTimeout(2500);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/invalid or has expired/i);
});
