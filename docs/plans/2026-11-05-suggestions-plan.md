# Suggestions plan (5 Nov 2026)

This plan reviews the 10 suggestions in the `suggestions` tab of **CRM Tradelink Data Storage**, plus two requests made in chat: Yelp **and** Google presence, and a new call outcome. Each decision is written to the sheet's **decision** column with a short note.

## Decisions

| Sheet row | Page | Suggestion | Decision | Plan |
|---|---|---|---|---|
| 2 | Leads | "just testing if the suggestions box works" | Rejected (test entry) | — |
| 3 | Dashboard | Sync my Gmail | Implemented | Email tab, shipped in v1.0.19 |
| 4 | Dashboard | See their Yelp page when calling (+ chat: Yelp and Google) | Approved | C |
| 5 | Call Mode | Edit the script in Call Mode; different per lead | Approved | E |
| 6 | Call Mode | Enter should submit a suggestion | Approved | B |
| 7 | Call Mode | Add leads to the call queue myself | Approved | A |
| 8 | Lead Detail | Post a note with date and time; edit and delete it later | Approved | D |
| 9 | Contact Detail | Pick several services on an opportunity | Approved | F |
| 10 | Call Mode | Queue randomly switches companies; lock the next 10 | Approved (bug) | A |
| 11 | Call Mode | Mobile: save the number as a contact (dylan@tradelink.marketing) after a call | Approved | G |
| (chat) | Call outcome | "Warm – Not Ready Yet" | Done on this branch | H |

Build order: **A + B** (bug fix plus a one-line fix), then **C**, **D**, **E** (E uses C's data), **F**, **G**. C's automatic check (phase 2) is optional.

---

## A. A call queue that doesn't shuffle, plus "My queue" (rows 10 and 7)

**Why it switches today** (in `src/lib/queue.ts` and `src/pages/CallMode.tsx`):
1. The queue is rebuilt from scratch on every data change: the 45-second sync, switching back to the app, edits from the other device, and Lead Finder data loading. The card on screen is just whatever is first at that moment, so it can change mid-call.
2. Follow-ups due *later today* count as due *now*. Logging **Busy** (or tapping **Later today**) schedules a call-back 2 hours out, and that lead jumps straight back to the top. This is the "adds one".
3. Ties are broken by "created" time, which Lead Finder businesses don't have until you touch them. Most score 100, so touching one (a note, a 👍) reshuffles the others. This is the "skips one".
4. Skips are forgotten when you leave Call Mode (for example after tapping **Open**), so skipped leads come back.
5. Side effect: the Notes box follows whichever business is on top. If the queue switches while you're typing, the note can land on the wrong business.

**Plan**
- **Locked session queue.** Opening Call Mode takes the next 10 and keeps them in that order. The list is saved on the device, so it survives leaving the page or the app. A lead leaves the list only when you:
  - log a call on it,
  - skip it, or
  - it becomes uncallable (deleted, converted, or marked Do Not Call or disqualified on the other device). This shows as a small note rather than happening silently.

  When all 10 are done, the next 10 load. **Refresh queue** and changing the trade filter rebuild it deliberately.
- **My queue.** An **Add to call queue** button goes on lead and contact pages, the Leads bulk menu, and Lead Finder rows, plus a "Queue a lead…" search in Call Mode.
  - Leads you queue always come before the auto 10, in the order you added them.
  - The queue is stored on the record (a `queuedAt` column), so it syncs: queue on the Mac, call from the phone. Queuing a Lead Finder business saves it to the sheet, the same as calling or noting it.
  - Logging a call clears it from the queue, and ✕ removes it.
- **Follow-ups** count as due when their time arrives, not at the start of the day. Ones that come due during a session don't jump in. Instead a banner says "2 follow-ups due now", with a button to add them to your queue.
- Notes, outcome and script stay tied to the locked current lead.
- **Tests:**
  - the order stays stable across syncs and edits,
  - a Busy lead doesn't come back until its follow-up is due,
  - skips survive navigation,
  - queued leads come first.
- **Files:**
  - `src/lib/queue.ts`, new `src/lib/callsession.ts`
  - `src/pages/CallMode.tsx`, `Leads.tsx`, `LeadDetail.tsx`, `Contacts.tsx`, `LeadFinder.tsx`
  - `src/lib/types.ts`, `apps-script/Code.gs` (column list)
- **Size:** medium.

## B. Enter submits a suggestion (row 6)
- In the suggestion box and the **New suggestion** window, Enter submits and Shift+Enter adds a new line.
- **Files:** `src/components/SuggestionBox.tsx`, `src/pages/Suggestions.tsx`.
- **Size:** tiny.

## C. See how they show up on Yelp and Google (row 4 + chat request)
Your lead notes keep repeating the same pitch ("not on Yelp… not showing up on AI search… not on Google yet"). This feature should both show the listing and record what you found.

**Phase 1: no setup, works on Mac and Android**
- An **Online presence** card on lead and contact pages, and in Call Mode beside the script:
  - **Yelp**: one tap searches Yelp for the business name in its city.
  - **Google**: one tap opens the Google Maps / Business Profile search, and one tap a Google search (reviews, knowledge panel).
  - **Record the result** with one tap:
    - Yelp: *Listed*, *Not listed* or *Unclaimed*.
    - Google: *Listed*, *Not listed* or *Unverified*.
    - Optionally paste the listing link and the stars and review count.
  - **Storage:** saved on the record (`yelpStatus`, `yelpUrl`, `googleStatus`, `googleUrl`, `presenceCheckedAt`), so it syncs and carries over when a lead becomes a contact.
- **Where the page opens:** Yelp and Google won't load inside a frame in our page.
  - On the Mac, it opens in a window docked beside the CRM, so it stays visible during the call.
  - On Android, it opens in an in-app browser tab and you swipe back to the call.
- **Leads list filters:** *Not on Yelp* and *Not on Google*. These are TradeLink's best prospects.
- **Script placeholders (plan E):** `{yelp}` and `{google}`. For example, *Not listed* gives "I noticed {company} isn't on Yelp yet, and that's where AI assistants pull local recommendations from."

**Phase 2: optional automatic check**
- **Google (recommended).** The Google Places API looks a business up by name and city and returns the listing, rating and review count.
  - Each product has its own free monthly allowance. Lookups that include ratings are reported at about 1,000 free a month, then about $35 per 1,000. Confirm on Google's pricing page.
  - At around 60 calls a day that's roughly $10 a month. It needs a Google Cloud API key with billing turned on.
- **Yelp (not now).** Yelp's API can match by phone number. But its free trial is for evaluation only, and commercial use is reported at around $229 a month. It's not worth it unless manual checks become a bottleneck.
  - Exception: you mention being a Yelp partner. If your partner account includes Yelp API access, the automatic Yelp check becomes worth building.
- **Background pre-check:** the locked 10 are checked before you dial, so the card is already filled in.

**Files**
- New `src/components/Presence.tsx` and `src/lib/presence.ts`.
- `LeadDetail.tsx`, `Contacts.tsx`, `CallMode.tsx`, `Leads.tsx`.
- `src/lib/actions.ts` (conversion copies the fields).
- `electron/main.cjs` and `electron/preload.cjs` (docked window).
- Android in-app browser (`@capacitor/browser`).

**Size:** phase 1 medium; phase 2 small to medium.

## D. Post notes with date and time (row 8)
Today the Notes box is one undated text field. The history's **Log** button can already save a dated note that you can edit or delete, but it's hard to find.
- **Composer.** The Notes box becomes a composer: type, then **Post note** (or ⌘/Ctrl+Enter). The note is saved with the date and time and the box clears.
- **Feed.** Posted notes list under the box, newest first. Each shows its date and time, with ✏️ to edit in place and 🗑 to delete (with Undo). Edited notes show "edited …".
- **Same data as today.** These are the same note entries the history already uses. They sync to the `activities` tab and still show on the contact page after a lead is converted.
- **Existing notes.** Today's notes text stays, as a smaller **Pinned summary**. It doubles as a one-line reminder in Call Mode.
- **Files:**
  - `src/components/Detail.tsx` (new notes feed)
  - `src/components/Timeline.tsx` (shared editor)
  - `LeadDetail.tsx`, `Contacts.tsx`, `CallMode.tsx`, `src/components/Opportunity.tsx`
- **Size:** small to medium.

## E. Edit the script in Call Mode, per lead (row 5)
- **Edit in place.** An **Edit** button on Call Mode's Script card edits the script in place, with buttons to insert `{company}`, `{name}`, `{city}` and so on.
- **Save choice.** When saving, pick:
  - **Just this lead**: stored on the lead (a `script` column) and synced.
  - **Make it my default.**
- **Phase 2: script library.** Settings gets a small library (for example *Default*, *New business*, *Not on Yelp/Google*, and one per trade), and Call Mode picks one per lead automatically:
  - a brand-new license gets *New business*,
  - not on Yelp gets *Not on Yelp*,
  - otherwise the trade's script.

  A dropdown switches scripts.
- **Files:** `CallMode.tsx`, `Settings.tsx`, `src/lib/format.ts` (placeholders), `types.ts`, `Code.gs`.
- **Size:** phase 1 small; phase 2 medium.

## F. Several services on one opportunity (row 9)
- **Multi-select.** The service chips become multi-select in three places:
  - **New opportunity**,
  - the opportunity window (chips replace the dropdown),
  - the Meeting Booked → convert step.
- **Storage.** Services are saved in the same `service` column as a list, e.g. "Yelp Ads, SEO / Google Business Profile", so existing deals keep working. The default name becomes "Company – Yelp Ads + SEO / Google Business Profile".
- **Pipeline.** The service filter matches any of a deal's services, and cards list them all.
- **Value.** Monthly value stays the deal total. Per-service prices can come later if you want them.
- **Settings** stops custom service names from containing commas.
- **Files:** `src/components/Opportunity.tsx`, `CallFlow.tsx`, `actions.ts`, `Pipeline.tsx`, `Settings.tsx`.
- **Size:** small.

## G. Save called numbers to the phone's contacts (row 11)
- **What it saves.** After you save a call outcome on Android, the app saves "Name – Company" with the number, company, title and a "TradeLink CRM · trade · city" note.
- **Where it goes.** The contact goes into the phone's contacts **under dylan@tradelink.marketing**, with a "TradeLink CRM" label. Android syncs it to that Google account, so it appears in Google Contacts everywhere and as caller ID when they call back.
- **No duplicates.** If the number is already saved, the contact is updated instead.
- **Setting.**
  - Choices: *Off*, *Every call*, *Only when I spoke to someone*.
  - It also asks which account to use, listing the Google accounts on the phone.
  - The default is *Every call*, as you asked. The label keeps them together if you ever want to clean up.
- **Setup.** It asks for the Contacts permission once. dylan@tradelink.marketing has to be added on the phone with Contacts sync turned on.
- **Later option.** Saving from the Mac too would go through the TradeLink Email connector (Google People API), which needs a one-time re-approval in Apps Script for Contacts access.
- **Files:**
  - `android/app/src/main/java/com/tradelink/crm/TradeLinkNativePlugin.java` (`saveContact`, `listAccounts`)
  - `android/app/src/main/AndroidManifest.xml`
  - `src/lib/platform.ts`, `CallFlow.tsx`, `Settings.tsx`
- **Size:** medium, and it needs testing on your phone.

## H. Done on this branch: "Warm – Not Ready Yet" call outcome
For calls that went well where the prospect isn't ready to buy but wants to stay in touch ("saved my info, call me after the new year"):
- It counts as a **connect** and marks the lead 👍 **Nurture** (not now, revisit later).
- It pre-fills a **high-priority follow-up 30 days out**, which you can change in the outcome form.
- Nurture leads stay out of the auto queue until that follow-up is due, then come back at the top.
- **Files:** `src/lib/constants.ts`; tests in `src/lib/__tests__/outcomes.test.ts`.

## Shipping
Release builds run on pushes to `claude/admiring-knuth-2gio93` (or `main`/`master`). This branch, `claude/zealous-johnson-ovolsa`, doesn't trigger one. Merge it into `claude/admiring-knuth-2gio93` to ship it to the Mac and Android apps.
