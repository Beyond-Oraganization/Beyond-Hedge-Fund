# Trying the redesign mockup with people

Step 1 of the redesign plan (`docs/fund-app-redesign-plan.md` in the bot repository). The mockup is `docs/redesign-mockup.html`. It is grey on purpose, and its data are examples, not anyone's money.

## Whom to ask

Two or three people, 20 minutes each:
- **One or two likely clients:** people who might give the fund money, and who don't build trading software.
- **One person in a staff role,** if you have one. Otherwise yourself, last.

Three people find most of the big problems. Don't wait for more.

## Before each session

1. Open the mockup and press **Start over**.
2. Untick **Design notes**, so the notes don't steer the person.
3. For a client, open it on a phone if you can (the phone layout fills the screen). Otherwise pick **Client · phone**.
4. Say: "This is a rough sketch of an app, not the finished thing. I'm testing the sketch, not you. Please think out loud. If something is confusing, that's what I need to find. I won't help, but I'll answer at the end."

## Tasks for a client

Read each task out loud, then stay quiet. Note where they look first, what they say, where they hesitate, and whether they finish.

1. "Sign in. The login and password are already filled in. Any six digits work as the code."
2. "How much is your money worth right now?"
3. "How did it do this month?" *Watch:* do they read the jump in early November as a gain? (It was a deposit.)
4. "Is anything wrong with your account?"
5. "Which strategies trade for you?"
6. "Add a careful strategy and give it 3,000 euros."
   *Watch:* do they understand "Careful / Steady / Bold", "Worst fall" and "Room for 4 positions"? Then try 5,000 euros. Do they understand the limit message?
7. "You'd like to stop the gold strategy. Do it."
   *Then ask:* "What do you think happens to the trade it has open?"
8. "Where would you find your statement for October?"

Afterwards, ask:
- "What did you expect to see that wasn't there?"
- "What would make you trust this with your money? What would make you distrust it?"
- "How often would you open it?"

## Tasks for staff

1. Pick **Staff · computer**. "Which client needs attention first, and why?"
2. "Open Client A. Let them also use 'Gold breakout', and allow three strategies at once."
3. "Now see what Client A sees." (View as client.) "Can Client A start Gold breakout?"
4. "What happened today, and who did it?"

## Afterwards

Write down, for each task, whether it finished, how long it took, and the words the person used. List the problems by how much they got in the way, not by how often they came up. Fix the worst ones in the mockup before step 2 (the design tokens and components).

## Questions the mockup leaves open for you

- **Stopping a strategy:** clients can't close positions by hand. Should stopping a strategy close its open positions, or leave them for the fund to close? Task 7 shows what people expect.
- **Currencies in totals:** Bybit accounts are in USDT. Should Overview total everything in EUR at today's rate, as drawn, or show each currency on its own?
- **What a statement holds:** start and end value, deposits and withdrawals, results by strategy. No fees yet.
- **Limits:** are the four limits (allowed setups, largest budget, strategies at once, Live allowed) enough? Clients might also expect a stop-loss for the whole account.
