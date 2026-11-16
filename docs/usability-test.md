# Usability test with three clients

Step 18 of the redesign plan (`docs/fund-app-redesign-plan.md` in the bot repository), the last one. Steps 1–17 built the app. This step watches three people use it, so the worst problems get fixed before real clients rely on it.

A usability test checks whether people can do what the app is for. It doesn't check whether they like it. You watch one person at a time do set tasks and think out loud, and you don't help.

## What it should answer

The plan's success measure: **a new client finds the portfolio's value and this month's return within 10 seconds, unaided** (2 of 3 people or better). Beyond that:

1. Do people read a deposit as a gain, or understand that the return leaves it out?
2. Can they find what trades for them, and stop it?
3. Do they understand the menu (Careful / Steady / Bold, the budget, the limit message)?
4. Can they find a month's statement and save it as a PDF?
5. What do they think happens to an open trade when they stop a strategy? (Still open in the plan.)

## Whom to ask

Three people, about 30 minutes each, one at a time:
- **Two likely clients:** people who might give the fund money, and don't build trading software.
- **One person who isn't a likely client** (a friend, a relative). Early problems trip up everyone.

Three people find most of the big problems. Don't wait for more. Run another three after fixing.

## Where to run it

**Recommended: the app against the mock bot, on your laptop.** It has 70 days of history, a deposit, closed trades, two strategies on the menu and limits. It needs no server change and no real money, and any 6-digit code works. Start it:

```bash
cd pwa && npm run dev:mock
```

Then open <http://localhost:5173> and narrow the browser window to phone width (or use the browser's phone view: Chrome's DevTools → Toggle device toolbar).

Sign-in for the person: server `http://127.0.0.1:8443`, login `carol`, password `demo-password`, any 6-digit code except 000000.

To start each session from the same state, restart `npm run dev:mock`.

*Alternative: the real app against the Demo account on the server.* This is more realistic on a real phone, but first:
- merge and deploy bot #27 and app #13 (statements);
- add a menu setup (`menu add …`) and set Test Client's limits (`clients limits …`);
- sign Test Client in on your phone beforehand, since its code app is yours.

The server has history only since 15 November, so "last month's statement" would be nearly empty there. Use the mock for the statement task.

## Before each session

1. Restart the mock, sign in as carol, and go to Home (or start signed out, for task 1).
2. Close every other tab and notification.
3. Ask whether you may record the screen and their voice. If they say no, take notes only.
4. Read this out:
   > "This is an app for clients of an investment fund. The money in it is made up. I'm testing the app, not you: you can't do anything wrong here. Please think out loud: say what you're looking at, what you're trying to do, and what you expect. I won't help while you try, because I need to see where the app gets in the way. I'll answer your questions at the end."

## Tasks for a client (about 20 minutes)

Read each task out loud, then stay quiet. If they ask you something, ask back: "What would you do if I weren't here?" Stop a task when it's done, when they're really stuck, or when you're learning nothing new.

| # | Task (read out) | Done when | Watch for |
|---|---|---|---|
| 1 | "Sign in. Your login is carol and your password is demo-password. Your code app would give you six digits: type any six." | Home shows | Hesitation over the server address or the code step |
| 2 | "How much is your money worth right now?" *Time it from when you finish reading.* | They say the figure | Over 10 seconds? Do they read "Your portfolio"? |
| 3 | "How did it do this month?" | They say the month's return | Do they read the November jump on the chart as a gain? It's the 2,000 deposit. Do they notice "Deposits … not counted"? |
| 4 | "Is anything wrong with your account?" | They give an answer, either way | Do they find "Everything is running" on Home, and trust it? |
| 5 | "What is trading for you at the moment?" | They name it, or say they can't tell | Do they read "Trading for you" on Home, or go to Strategies? Does "A strategy run by the fund" make sense to them? |
| 6 | "Add the careful strategy and give it 5,000 euros." Then: "Now try 3,000." | 5,000 refused and understood; 3,000 started or checked | Do they understand "It would not start … your largest here"? Why does it say the balance is 9,990.64 when Home says 10,472.72? (pilot finding 3) |
| 7 | "You'd like the gold strategy to stop trading for you. Do it." Then ask: "What do you think happens to a trade it has open?" | Stopped | Their answer to the question settles the open plan question |
| 8 | "How did your money do last month? Find the statement, and save it as a PDF." (Name the month; the mock keeps the last 70 days.) | Last month's statement is open and the print dialog shows | Do they look under Account? Do they read the summary table top to bottom? |
| 9 | "What happened on your account yesterday?" | They read Activity | "Closed a Euro / US dollar trade": do they understand it, and the red amount beside it? |

## Afterwards (5 minutes)

Ask:
- "What did you expect to see that wasn't there?"
- "Was anything confusing, or worded strangely?"
- "What would make you trust this with your money? What would make you distrust it?"
- "How often would you open it?"

Then thank them.

## Tasks for staff (optional, yourself or a colleague)

Sign in as `sam` / `demo-password`, at laptop width.
1. "Which client needs attention first, and why?"
2. "Open Carol Example. Let her use only the careful strategy, with at most 3,000 euros."
3. "See what Carol sees. Could she start the gold strategy now?"
4. "Print Carol's statement for last month."

## The note sheet

One row per task, per person:

| Person | Task | Done? (yes / with trouble / no) | Time | Where they looked first | Their words (quotes) | Problem seen |
|---|---|---|---|---|---|---|

Write down their exact words, especially the ones they use for things the app names differently.

## After the three sessions

Right after the last session (an hour is enough):
1. Write down the three worst problems you saw, without discussing them yet.
2. Rate each problem by **how badly it got in the way**:
   - *blocks:* the person couldn't finish;
   - *slows:* they finished, with difficulty;
   - *minor.*

   Also rate **how many of the three people hit it**.
3. Fix the ones that block first, cheapest first. A small change that takes a problem out of "blocks" is enough for now.
4. Don't add explanations to fix confusion. Remove what hides the meaning instead.
5. Treat feature requests with care: ask what the person was trying to do.
6. Run three more people after the fixes.

## What I found walking the tasks myself (a pilot, 16 Nov 2026)

I did tasks 1–9 on the mock at phone width before anyone else does. This is no substitute for real people (I know how the app works), but these are likely to show up. Most severe first:

1. **Home doesn't say whether anything is wrong, or what is trading.**
   - The plan's Home has "Everything is running" (or what needs attention) and "1 strategy trading: Gold trend, steady". Neither is built.
   - Task 4 will probably fail and task 5 needs a second screen.
   - *Fix:* a status line and the running strategies' plain names on Home, from the client's sessions and the alerts.
2. **The bot's words reach clients:**
   - A strategy started by staff (not from the menu) shows as "drcs", and Stop asks "Stop drcs? It opens nothing new. Nothing of it is open now."
   - Activity says "Closed XAUUSD buy 2" and "Closed EURUSD sell 0.5".
   - *Fix:* show the menu name, or "A strategy run by the fund", and say "Gold" / "Euro against dollar" and "a trade" in place of symbols and sizes.
3. **Two numbers for the same money:** Home shows 10,472.72 EUR (with open positions), but the limit message says "40% of the 9,990.64 EUR balance". A client will ask which is right. *Fix:* say "of the 9,990.64 EUR not in open trades", or base the limit on the value.
4. **An expired sign-in speaks to the owner:**
   - A client whose sign-in ended sees "The bot refused the API key".
   - A red "Your sign-in has ended" band shows over the same screen.
   - *Fix:* one message, "Your sign-in has ended: sign in again to see the latest", with the button.
5. **The app is called "Beyond Bot"** in the header, the tab title and "Lock the bot", but "Beyond Hedge Fund" on sign-in and statements. *Fix:* "Beyond Hedge Fund" for every person who signs in, keeping "Beyond Bot" only for the API key.
6. **A running strategy shows no result.** The plan says name, since when, and its result; it shows "Since 16 Nov · 1 trade". *Fix:* add the session's result so far.
7. *(Minor)* The code step says "for Beyond Hedge Fund" twice, in the paragraph and in the hint under the field.

**Fixed before the test:** 1, 2, 4 and 5 (app PR "Plain words for clients", bot #27 for naming menu starts in Activity). Still open: 3, 6 and 7.

Fixing them first means the test finds new problems rather than these. They are small changes in the app. For 1, a client can already read their sessions, each with its last error, through `session strategies`. The fund's alerts (`fund overview`) are staff's, so "needs attention" for a client would start from their own sessions' errors.
