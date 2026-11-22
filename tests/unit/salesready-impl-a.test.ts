// Sales-ready IMPL-A, pure parts:
//   SR-1  newsletter off (settings.newsletter.enabled = false, until İYS): the register form's commercial
//         e-mail box is offered only while the newsletter is on and the server ignores a ticked (forged)
//         box otherwise; the success screen's "we also sent a confirmation e-mail" line only for a request
//         the newsletter service accepted; the profile hides "E-bültene abone ol" and says "şu an kapalı"
//         (tr/en/ar), never a generic "forbidden"; the home page newsletter section renders nothing.
//   SR-4  subscription renewals follow CF-11 (card test mode on a live site → held "card_test_mode").
// The DB halves: tests/db/salesready-impl-a.test.ts (and tests/db/salesready-fix.test.ts for the profile's core).
// FIX F11: the behaviour is tested on the pure functions (registerSuccessMarketing) and in the DB tests; the few
// source checks left here only pin the wiring (which function a file calls), never the behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import ar from "@/i18n/messages/ar";
import en from "@/i18n/messages/en";
import tr from "@/i18n/messages/tr";
import { registerMarketingNotice, registerNewsletterRequested, registerSuccessMarketing, type RegisterNewsletterOutcome } from "@/lib/account/register-newsletter";

const source = (file: string) => readFileSync(file, "utf8");

describe("SR-1: the register form's newsletter box", () => {
  test("only an offered (newsletter on) and ticked box requests the double opt-in", () => {
    assert.equal(registerNewsletterRequested({ newsletterEnabled: true, ticked: true }), true);
    assert.equal(registerNewsletterRequested({ newsletterEnabled: true, ticked: false }), false);
    assert.equal(registerNewsletterRequested({ newsletterEnabled: false, ticked: true }), false, "a forged or stale box with the newsletter off is ignored");
    assert.equal(registerNewsletterRequested({ newsletterEnabled: false, ticked: false }), false);
  });

  test("the success line only for a request the newsletter service accepted", () => {
    const shown: RegisterNewsletterOutcome[] = ["pending", "already_active", "throttled"];
    const hidden: RegisterNewsletterOutcome[] = ["off", "not_requested", "disabled", "invalid_email", "failed"];
    for (const outcome of shown) assert.equal(registerMarketingNotice(outcome), true, outcome);
    for (const outcome of hidden) assert.equal(registerMarketingNotice(outcome), false, outcome);
  });

  test("registerSuccessMarketing: a new account shows the line only for an accepted request; a failed records step never", () => {
    const outcomes: RegisterNewsletterOutcome[] = ["off", "not_requested", "pending", "already_active", "throttled", "disabled", "invalid_email", "failed"];
    for (const newsletterEnabled of [true, false]) {
      for (const ticked of [true, false]) {
        for (const outcome of outcomes) {
          assert.equal(
            registerSuccessMarketing({ existedBefore: false, newsletterEnabled, ticked, newAccountOutcome: outcome }),
            registerMarketingNotice(outcome),
            `${newsletterEnabled}/${ticked}/${outcome}`,
          );
        }
        assert.equal(registerSuccessMarketing({ existedBefore: false, newsletterEnabled, ticked, newAccountOutcome: null }), false, "records failed");
      }
    }
  });

  test("registerSuccessMarketing: an address that already had an account gets the answer a new account normally gets (no enumeration)", () => {
    for (const newsletterEnabled of [true, false]) {
      for (const ticked of [true, false]) {
        // What recordNewAccount normally reports for a brand-new account with the same form.
        const requested = registerNewsletterRequested({ newsletterEnabled, ticked });
        const normalNew: RegisterNewsletterOutcome = requested ? "pending" : newsletterEnabled ? "not_requested" : "off";
        const existing = registerSuccessMarketing({ existedBefore: true, newsletterEnabled, ticked, newAccountOutcome: null });
        const brandNew = registerSuccessMarketing({ existedBefore: false, newsletterEnabled, ticked, newAccountOutcome: normalNew });
        assert.equal(existing, brandNew, `${newsletterEnabled}/${ticked}`);
      }
    }
    assert.equal(
      registerSuccessMarketing({ existedBefore: true, newsletterEnabled: false, ticked: true, newAccountOutcome: "pending" }),
      false,
      "newsletter off: never, whatever outcome is passed",
    );
  });

  test("wiring: registerAction composes its answer with registerSuccessMarketing from the fresh setting", () => {
    const action = source("src/lib/account/auth-actions.ts");
    assert.match(action, /const newsletterEnabled = await isNewsletterEnabled\(db\);/);
    assert.match(action, /registerSuccessMarketing\(\{ existedBefore, newsletterEnabled, ticked: data\.marketing, newAccountOutcome \}\)/);
    assert.doesNotMatch(action, /marketing: data\.marketing/, "the success state never echoes the submitted box");
    assert.doesNotMatch(action, /subscribeNewsletter\(/, "subscriptions go through recordNewAccount");
  });

  test("the form shows the box only with newsletterOptIn, and the page passes the cached setting", () => {
    const form = source("src/components/store/account/RegisterForm.tsx");
    assert.match(form, /\{newsletterOptIn \? <CheckboxField name="marketing"/);
    assert.match(form, /\{state\.marketing \? <p[^>]*>\{m\.successMarketing\}<\/p> : null\}/);
    const page = source("src/app/[locale]/hesap/kayit/page.tsx");
    assert.match(page, /getSettings\("newsletter"\)/);
    assert.match(page, /newsletterOptIn=\{newsletter\.enabled\}/);
  });
});

describe("SR-1: profile and home page while the newsletter is off", () => {
  test("marketingClosed exists in tr, en and ar", () => {
    assert.match(tr.account.profilePage.marketingClosed, /şu an kapalı/);
    assert.ok(en.account.profilePage.marketingClosed.includes("currently closed"));
    assert.ok(ar.account.profilePage.marketingClosed.includes("مغلق"));
    for (const m of [tr, en, ar]) assert.notEqual(m.account.profilePage.marketingClosed, m.account.errors.forbidden);
  });

  test("wiring: the profile hides subscribe/resend while off, keeps the withdrawal; the action goes through profileMarketingSubscribe", () => {
    const forms = source("src/components/store/account/ProfileForms.tsx");
    assert.match(forms, /const canSubscribe = newsletterOn && state !== "subscribed";/);
    assert.match(forms, /const canWithdraw = state !== "off";/);
    assert.match(forms, /closedAndOff \? p\.marketingClosed/);
    const page = source("src/app/[locale]/hesap/profil/page.tsx");
    assert.match(page, /newsletterOn=\{newsletter\.enabled\}/);
    // The behaviour (newsletter off: closed, nothing written) is tested on profileMarketingSubscribe in tests/db/salesready-fix.test.ts.
    const actions = source("src/lib/account/actions.ts");
    assert.match(actions, /profileMarketingSubscribe\(tx, /);
    assert.match(actions, /outcome\.reason === "closed" \? m\.profilePage\.marketingClosed : m\.errors\.forbidden/);
    assert.doesNotMatch(actions, /subscribeNewsletter\(/, "the profile subscribes only through the core");
  });

  test("the home page section renders nothing while off (cached settings read, like the footer band)", () => {
    const section = source("src/components/sections/Newsletter.tsx");
    assert.match(section, /const newsletter = await getSettings\("newsletter"\);\s*if \(!newsletter\.enabled\) return null;/);
    assert.doesNotMatch(section, /from "next\/(headers|server)"/, "no request-time reads on a static page");
    assert.match(source("src/components/store/Footer.tsx"), /newsletter\.enabled \?/);
    assert.match(source("src/app/[locale]/odeme/page.tsx"), /newsletterOptIn=\{newsletter\.enabled \? messages\.newsletter\.checkoutOptIn : null\}/);
  });
});

describe("SR-4: renewals follow CF-11", () => {
  test("wiring: a card renewal is held only when the test mode is the sole blocker (FIX F7); new payments use getCardGatewayFor", () => {
    // The behaviour (held / failed with method_unavailable) is tested in tests/db/salesready-impl-a.test.ts.
    const renew = source("src/lib/subscriptions/renew.ts");
    assert.match(renew, /export type RenewHoldReason = "legal_unavailable" \| "card_test_mode";/);
    assert.match(
      renew,
      /settings\.payments\.card\.enabled && cardTestModeHidden\(settings\.payments, null\) && \(await getCardGateway\(settings\.payments\)\) !== null;/,
    );
    assert.match(renew, /const gateway = await getCardGatewayFor\(settings\.payments, null\);/);
    assert.match(renew, /if \(sub\.paymentMethod === "card" && cardTestModeHeld\) \{/);
  });
});
