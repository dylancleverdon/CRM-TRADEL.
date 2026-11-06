# CRM improvements plan (6 Nov 2026)

Agreed with Dylan after a brainstorm. The biggest blocker right now is **getting the right people on the phone**, and **booked meetings** are the measure of success. Optimizing for pipeline value or close rate comes later.

In scope: **1, 2, 6, 7, 9, 12, 15**. Everything else from the brainstorm is dropped, including the automatic Google check, sequences, nurture, the "sorry I missed you" text, proposals, client tracking, search and duplicates.

| # | What | Ships as | Status |
|---|---|---|---|
| 1 | Lock the sync link with a private key | first | Shipped in v1.0.27 |
| 2 | Daily backups, keep 2 | with 1 | Shipped in v1.0.27 |
| 6 | Save and call next + keyboard shortcuts | next | Shipped in v1.0.28 |
| 9 | Lead engine (learns who books meetings) | with 12 | Shipped in v1.0.30 |
| 12 | Dashboard scorecard + "when owners pick up" heatmap | with 9 | Shipped in v1.0.30 |
| 15 | Phone: simpler lead page, follow-up reminders (opt-in) | after | |
| 7 | Google Calendar invites with Google Meet | last; needs a one-time connector update | |

---

## 1. Lock the sync link

**Why.** The sheet's sync URL is in the public app code. Anyone who reads it can:
- read or change all CRM data,
- wipe it (there's a public `reset` action),
- make the phone dial while Desk phone mode is on.

**Server (Code.gs).**
- A random key is kept in Script Properties and shown in a new **🔒 Sync key** tab. The sheet isn't shared with anyone, so only Dylan can see the tab.
- Until **Lock my CRM** is pressed, nothing changes, so no device is ever cut off by surprise. After that, every request needs the key, except a bare `ping` and `tlReload` (which only re-downloads the official code).
- The public `reset` action is removed.
- Devices that sync are recorded, so Settings can show which ones already have the key.

**Apps.**
- The key is stored only on each device: never in the sheet's data and never in the code. It's sent with every sync and every Desk phone request.
- Settings → Sync gets a security card: the key, which devices have it, **Send key to my phone** (through the private email connector), and **Lock my CRM**.
- A banner shows until the CRM is locked.

**What Dylan does (≈2 minutes, no Apps Script):** copy the key from the tab, paste it on the Mac, tap Send key to my phone, then Lock my CRM.

**CI.** The release sync check only pings once the CRM is locked; the code-reload step needs no key.

**Follow-ups found after shipping (v1.0.29).**
- An older deployment of the sheet's script (ID ending `…pK2oX-7A0w`) was still live, running pre-lock code that ignores the key and still has the public reset. Its link is in the public code. Dylan archives it in Apps Script → Manage deployments.
- The email connector now follows the lock with the same key (checked with the sheet, stored only as a hash, re-checked every 10 minutes). A phone without the key can still receive it from the Mac.
- The sheet's ping now sets up only what's missing (it used to reformat every tab).

## 2. Daily backups, keep 2

- Two backup spreadsheets in Dylan's Drive, **CRM Tradelink Backup – A** and **– B**.
- They're overwritten on alternating days, so there are always two recent days of backups, the newer one from today or the last day the apps synced.
- A backup runs on the first sync of each day, before that sync's changes are applied. There's nothing to schedule: on a day nobody syncs, nothing has changed.
- Settings shows the last backup time with links to both sheets.

## 6. Save and call next

- **The button.** The call outcome form gets a primary **Save and call next** whenever Call Mode is open. It saves the outcome, moves to the next lead and rings the phone right away, with no countdown.
- **Enter.** Enter presses **Save and call next**, even while typing notes; Shift+Enter adds a new line in the notes.
- **Outcome keys.** **1–0** pick outcomes, but only when you're not typing. Do Not Call has no key, so it's never picked by accident.
- **Notes.** The form opens without the cursor in the notes, so 1 + Enter logs a no-answer. **N** jumps to the notes; **Esc** while typing just stops typing, a second **Esc** discards.
- **Call Mode keys.** **Space** calls, **S** skips, **T** texts.
- **Meeting Booked.** Converts the lead and creates the opportunity in the background, then calls the next lead.

## 9. Lead engine

- **Goal.** Booked meetings per dial; switchable later (Settings). The engine tracks connects, meetings and pipeline value from day one, so switching uses all the history.
- **What it learns from.**
  - trade, city/area, business age (from the license date) and business type,
  - whether the owner's name is known and how many public lists the business is on,
  - Yelp/Google status once checked,
  - the current score bucket and the attempt number,
  - plus the day and hour of each call.
- **How.**
  - Each trait value gets a running estimate of connect rate × meetings-per-connect, shrunk toward the overall average until it has data.
  - Early on, when meetings are rare, it effectively learns from connects; meetings take over as they accumulate.
- **Experiments.** Each locked batch of 10 is 8 proven picks and 2 experiments, i.e. traits it knows least about. The share is adjustable in Settings.
- **Rules.** Due follow-ups stay first and untouched, there's no never-call list, and My queue still comes first.
- **Why this lead.** Call Mode shows it, e.g. "Proven · HVAC, licensed < 1 yr: 4 meetings / 50 dials" or "Experiment · Electrical in Everett: 3 dials so far".
- **Best time.** Call Mode shows best-time-to-call hints once there's enough data.
- **Tagging.** Every logged call records whether it was proven, an experiment, from My queue, or a follow-up.

**As built (v1.0.30).**
- Estimate per trait value: connect rate (shrunk toward the average over 20 dials) × meetings per connect, judged as meetings vs the meetings its connects would be expected to bring (3 meetings' benefit of the doubt). Your daily goals (60 → 12 → 2) are the starting averages. Traits combine at half weight, since they overlap.
- A trait is "proven" with 10+ dials and a lift above 5%. Until then the reason shown is the old one (e.g. "NEW business · score 92").
- Experiments are picked by the trade + city with the fewest dials (then the least-known trade, city, age and type), spread so two experiments in a batch try different places. Every 5th spot is an experiment at the default 2 per 10.
- Pipeline value = 12 × monthly value + setup fee of the deals from that lead, credited to the call that booked the meeting; closed deals = deals in a won stage.
- Best hours: an hour needs 8+ calls and 60+ calls in total, and must beat the average pick-up by 15%.
- Every call stores `pick` (proven / experiment / queue / followup) and `scriptKind` (default / custom): two new columns on the sheet's activities tab.

## 12. Dashboard

- **Scorecard:** dials → connects → meetings, this week vs last week (with Today and 30 days). It breaks down by trade, by script (default vs per-lead custom) and by experiment vs proven.
- **When owners pick up:** a weekday × hour heatmap of connect rate, switchable to meetings booked.
- **Engine status:** how much it has learned, plus the traits currently doing best.

## 15. Phone app

- **Lead and contact pages on the phone:** big **Call** and **Text** buttons. Everything else (Queue call, Save to phone, Log call, Convert, Good/Bad) moves under **More**.
- **Follow-up reminders:** a phone notification when a follow-up comes due (at the due time).
  - **Off by default**, with a toggle in Settings.
  - Scheduled on the phone, so it works with the app closed. Tapping it opens the lead.
  - Follow-ups created on the Mac reach the phone the next time it syncs.
- No phone email notifications: Gmail covers that.

## 7. Google Calendar invites (Google Meet)

**Flow.** Times are agreed over the phone. The client gets the Google Calendar invite with a Meet link (Google sends it) plus the "Meeting confirmation" email, with the meeting time and Meet link added automatically. Default title "TradeLink × {company}", description "Marketing plan call with Dylan Cleverdon, Yelp Partner at TradeLink · Tradelink.marketing · Dylan@tradelink.marketing". Default length 30 minutes.

**Where it's used.**
- **Meeting Booked** in the call outcome form shows a "Their email" box (saved to the lead) and the time picker.
- **Add meeting invite** in the email writer does the same from any email.

**Time picker.** 30-minute steps. It greys out times outside Dylan's weekly schedule and times already busy on his Google Calendar. The weekly schedule is set in Settings and can be changed anytime. No buffer between meetings.

**Reschedule / Cancel** buttons live in the CRM, and Google sends the update to the client.

**Upcoming meetings** show on the Dashboard, with Join links. Only meetings booked through the CRM are listed.

**One-time step for Dylan:** update the email connector, which only has Gmail access today.
1. Paste the new connector code.
2. Add the Google Calendar service.
3. Run updateNow and approve.
4. Deploy a new version; the URL stays the same.

The app shows the exact clicks.
