# TradeLink CRM

A cold-calling CRM for TradeLink's home-service outreach. It has a Mac desktop app and an Android app that share data through a Google Sheet.

## Downloads (always the latest version)

| Platform | Link |
|---|---|
| **Android APK** | https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/TradeLink-CRM.apk |
| **Mac installer (.pkg)** | https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/TradeLink-CRM-Installer.pkg |
| Mac disk image (.dmg) | https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/TradeLink-CRM.dmg |

**Mac one-line automatic installer.** Paste this into Terminal. No clicks needed, and no Gatekeeper prompt:

```bash
curl -fsSL https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/install-mac.sh | bash
```

> The `.pkg` and `.dmg` aren't signed with a paid Apple Developer ID. The first time you open one, macOS will block it. Go to **System Settings → Privacy & Security** and click **Open Anyway** (on older macOS you can right-click → Open instead). The Terminal command above avoids this entirely.

**Android:** open the APK link on your phone. When Android asks, allow your browser to "install unknown apps", then tap Install.

## Automatic updates
Every push to the repo builds both apps on GitHub Actions and publishes a new release.
- **Mac:** downloads the update in the background. It installs when you quit the app, or right away if you click **Restart now**.
- **Android:** downloads the new APK and opens the installer. You allow "Install unknown apps" for TradeLink CRM once; after that it's one tap.

## Google Sheet sync (one-time setup)
1. Open the sheet **CRM Tradelink Data Storage**, then go to **Extensions → Apps Script**.
2. Delete what's there, paste in [`apps-script/Loader.gs`](apps-script/Loader.gs) (the auto-update loader), and click **Save**.
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. On a first deployment, use *Execute as*: **Me** and *Who has access*: **Anyone**. Approve the permissions.

That's the last time you touch Apps Script. The loader downloads the real sync code ([`apps-script/Code.gs`](apps-script/Code.gs)) from the latest GitHub release and runs it. Each release then tells the sheet to reload, so server updates arrive automatically. A backup copy is stored in the script, so syncing keeps working even if GitHub is unreachable.

The apps already have the TradeLink sheet URL built in. The script creates these tabs: `leads`, `contacts`, `opportunities`, `activities`, `tasks`, `suggestions`, `settings`. You can edit rows directly in the sheet and the changes sync back to the apps. In the `suggestions` tab, use the **decision** dropdown.

## Security and backups
The sync link is in this public code, so your sheet also has a private **sync key**. Until you lock the CRM, anyone who finds the link could read or change it. Locking takes 2 minutes:
1. Open the sheet and go to the **🔒 Sync key** tab. Your sheet isn't shared, so only you can see it.
2. On the Mac, go to **Settings → Security & backups**, paste the key and click **Save key**.
3. Click **Send key to my phone**. The phone needs Desk phone mode on and email connected. You can also paste the key on the phone yourself.
4. Click **Lock my CRM**. From then on the sheet refuses every request without the key.

If you lose the key, it's always in that tab. To unlock, open Apps Script → Project Settings → Script properties and delete `tl_locked`.

**Old sync links:** every deployment of the sheet's script has its own link, and an old one keeps running the code it was deployed with, without the lock. In Apps Script → Deploy → Manage deployments, keep only the one the app uses (its ID ends in `…WLRacC4Jw`) and archive the rest.

**Email connector:** it follows the lock by itself. Once your CRM is locked, the connector (Gmail, and texts and contacts sent through your phone) also needs the key. It checks keys with your sheet and keeps only a hash, so a new key there takes over within 10 minutes and the old one stops working. A phone without the key can still receive it from the Mac (Send key to my phone), and nothing else. Settings → Security & backups shows whether it's locked.

**New key** (e.g. a lost phone): in Apps Script → Project Settings → Script properties, delete `tl_syncKey`. A new key appears in the 🔒 Sync key tab at the next sync; save it on your devices again.

**Backups:** the sheet keeps two copies in your Drive, *CRM Tradelink Backup – A* and *– B*. They're refreshed on alternating days at the first sync of the day, so you always have the last two days. Settings shows when the last backup ran, with links to both copies.

## Lead Finder (public records)
The **Lead Finder** page downloads every licensed home-service business in Washington from public open data:
- **WA L&I contractor registry:** about 76k active contractors, with phone numbers and owner names.
- **Seattle business licenses:** about 10k home-service businesses, with phone numbers.
- **Bellevue** (about 7.7k) and **Tacoma** (about 5.2k) business licenses: no phone numbers, but matched to the other sources by state business ID.

Each business is scored 0–100, and they all appear in Leads and Call Mode. A business is written to the Google Sheet only once you call, note or edit it. The data refreshes weekly.

## How the CRM is organized
The structure follows the common HubSpot, Salesforce and Pipedrive model:
- **Leads.** Unqualified businesses you're cold calling. Status goes New → Attempting → Connected → Qualified / Nurture / Disqualified → Converted. Each lead can be marked 👍 good or 👎 bad, with a reason.
- **Contacts.** Leads you've converted. Status is Prospect, Active Client or Past Client.
- **Opportunities.** Deals tied to a contact. Each has one or more services (Yelp Ads, SEO / GBP, Google Ads / LSA, Social, Reviews…), a monthly value plus setup fee, and a stage. Stages and win probabilities: Discovery Booked 20% → Discovery Held 35% → Proposal Sent 60% → Negotiation 80% → Closed Won / Lost.
- **Activities.** Every call, note, status change and stage change, with date and time, in one timeline. On lead, contact and opportunity pages (and in Call Mode) you **post** notes one at a time: each is saved with the date and time and can be edited or deleted later. The record's own notes field stays on top as a pinned summary.
- **Follow-ups.** Tasks with due dates. Logging a call outcome suggests the next follow-up automatically.
- **Call Mode.** Locks in your next 10 calls (due follow-ups first, then new leads, then retry attempts) and keeps them in that order until you call or skip them, even if you leave the page. Add any lead or contact to **My queue** from its page, the Leads list, Lead Finder or the search box in Call Mode, and it's called right after the current one. Follow-ups that come due during a session show in a banner instead of jumping in. It has your script, which you can edit right there for just that lead or as your default, and one-tap calling. On Android the call goes out on your own phone number, and when you return to the app it asks for the outcome. **Save and call next** on the outcome form saves and calls whoever is next right away (a booked meeting is converted to a contact and opportunity in the background). Keys on the Mac: **Space** call, **S** skip, **T** text; in the outcome form **1–0** pick the outcome, **N** jumps to the notes, **Enter** saves and calls next (Shift+Enter for a new line), **Esc** discards.
- **Lead engine.** Call Mode's order comes from what has worked. Every call teaches it which trades, cities, business ages and types, owner names, public lists, Yelp/Google status, scores and attempt numbers pick up and book meetings (early on it learns from who picks up; meetings take over as they come in). Each spot says why, e.g. "Proven · HVAC, Licensed < 3 mo: 4 meetings / 50 dials", and 2 of every 10 are experiments on businesses it knows least about ("Experiment · Electrical in Everett: 3 dials so far"). Due follow-ups and My queue stay first and nobody is ever left out. Settings → Lead engine switches what it optimizes for (booked meetings now; pipeline value or closed deals later, using all the history) and how many experiments it runs. With enough calls, Call Mode also shows the hours owners pick up most.
- **Dashboard insights.** A scorecard (dials → connects → meetings: today, this week vs last week by now, last 30 days), what the lead engine has learned, a weekday × hour heatmap of when owners pick up (or book meetings), and breakdowns by trade, by script (default vs a business's own) and proven vs experiment. Every call records whether it was a proven pick, an experiment, from My queue or a follow-up.
- **Online presence.** On every lead and contact, and in Call Mode: one tap searches Yelp and Google (by name, or by phone number for odd legal names). On the Mac the page opens in a window docked beside the CRM; on Android in an in-app browser. Mark what you found (Listed / Unclaimed / Not listed, the link, stars and reviews) and the call script mentions it through `{yelp}` and `{google}`. The Leads list can filter to businesses missing from Yelp or Google.
- **Phone contacts (Android).** After a call, the number is saved to the phone's contacts as "Name – Company" under dylan@tradelink.marketing (or another Google account), so it syncs to Google Contacts and shows as caller ID when they call back. Numbers already saved are left alone; new ones get a "TradeLink CRM" label. Choose every call, only connected calls, or off in Settings → Phone contacts. To add someone without calling, tap **Save to phone** on their page or in Call Mode (or pick leads in the Leads list → Save to phone contacts); on the Mac your phone does it, in Desk phone mode with email connected on both.
- **Email (Gmail / Workspace).** Connect your mailbox once per device on the Email tab. Email to and from your leads and contacts is logged to their history automatically, checked every minute while the app is open (on the Mac even in the background, with a notification for new mail). **Unread** shows new email from leads and contacts (a dot on the Email tab counts them); opening one, or ✓, moves it to **Read**, and marks it read in Gmail too. Click any email to read it in a window and **Reply** there with your templates. While writing, **Save as new template** or **Update** the template you started from (names and company are turned back into placeholders).
- **Meetings (Google Calendar + Meet).** When you log **Meeting Booked**, keep "Send a Google Calendar invite" ticked: check their email (it's saved to the lead), then pick the time you agreed on the phone. Times come in 30-minute steps; times outside your hours or already busy on your Google Calendar are greyed out, and "Another time…" covers a one-off. Google emails them the invite with a Google Meet link, the CRM sends your "Meeting confirmation" email with the time and link, and the follow-up becomes the meeting. **Add meeting invite** in any email does the same, filling in `{meetingTime}` and `{meetLink}` when you send. Meetings show on the record and under **Upcoming meetings** on the Dashboard, with Join, Reschedule and Cancel (Google emails them the change). Settings → Meetings holds your weekly hours, meeting length and the invite's title and description. **One-time setup:** Settings → Meetings shows the 4 steps to add Google Calendar to your email connector (paste the new connector code, add the Google Calendar API service, run updateNow, deploy a new version; the URL stays the same).
- **Phone app.** Lead and contact pages lead with big **Call** and **Text** buttons; everything else (Good/Bad, Convert, Queue call, Save to phone, Log a call) is under **More**. **Follow-up reminders** (Settings → Follow-up reminders, off by default, set per phone): a notification at each follow-up's time, even with the app closed; tap it to open the lead or contact. Tap **Allow on-time reminders** there so Android doesn't delay them. Follow-ups you make on the Mac reach the phone the next time it syncs (when you open the app).
- **Follow-up texts.** Text a lead or contact from your own number: the Text button on their page or in Call Mode, or tick "Text them" when you log a call. Your default message is in Settings → Follow-up text. On the Mac, your phone sends it (keep TradeLink open on the phone in Desk phone mode, with email connected on both: the request goes through your private email connector).
- **Today dashboard.** Calls, connects, meetings and follow-ups against your daily goals. It shows what's done and what's still to do, plus the last 7 days and a pipeline snapshot.
- **Suggestions.** A box at the bottom of every page. Suggestions are saved to the Suggestions tab of the sheet, and the app shows similar earlier suggestions and their decisions so nothing gets decided twice.

## Development
```bash
npm install
npm run dev            # browser at http://localhost:5173
npm run electron:dev   # desktop shell
```
