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
- **Online presence.** On every lead and contact, and in Call Mode: one tap searches Yelp and Google (by name, or by phone number for odd legal names). On the Mac the page opens in a window docked beside the CRM; on Android in an in-app browser. Mark what you found (Listed / Unclaimed / Not listed, the link, stars and reviews) and the call script mentions it through `{yelp}` and `{google}`. The Leads list can filter to businesses missing from Yelp or Google.
- **Phone contacts (Android).** After a call, the number is saved to the phone's contacts as "Name – Company" under dylan@tradelink.marketing (or another Google account), so it syncs to Google Contacts and shows as caller ID when they call back. Numbers already saved are left alone; new ones get a "TradeLink CRM" label. Choose every call, only connected calls, or off in Settings → Phone contacts. To add someone without calling, tap **Save to phone** on their page or in Call Mode (or pick leads in the Leads list → Save to phone contacts); on the Mac your phone does it, in Desk phone mode with email connected on both.
- **Email (Gmail / Workspace).** Connect your mailbox once per device on the Email tab. Email to and from your leads and contacts is logged to their history automatically, checked every minute while the app is open (on the Mac even in the background, with a notification for new mail). **Unread** shows new email from leads and contacts (a dot on the Email tab counts them); opening one, or ✓, moves it to **Read**, and marks it read in Gmail too. Click any email to read it in a window and **Reply** there with your templates. While writing, **Save as new template** or **Update** the template you started from (names and company are turned back into placeholders).
- **Follow-up texts.** Text a lead or contact from your own number: the Text button on their page or in Call Mode, or tick "Text them" when you log a call. Your default message is in Settings → Follow-up text. On the Mac, your phone sends it (keep TradeLink open on the phone in Desk phone mode, with email connected on both: the request goes through your private email connector).
- **Today dashboard.** Calls, connects, meetings and follow-ups against your daily goals. It shows what's done and what's still to do, plus the last 7 days and a pipeline snapshot.
- **Suggestions.** A box at the bottom of every page. Suggestions are saved to the Suggestions tab of the sheet, and the app shows similar earlier suggestions and their decisions so nothing gets decided twice.

## Development
```bash
npm install
npm run dev            # browser at http://localhost:5173
npm run electron:dev   # desktop shell
```
