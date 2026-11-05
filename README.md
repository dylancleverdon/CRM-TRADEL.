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
- **Opportunities.** Deals tied to a contact. Each has a service (Yelp Ads, SEO / GBP, Google Ads / LSA, Social, Reviews…), a monthly value plus setup fee, and a stage. Stages and win probabilities: Discovery Booked 20% → Discovery Held 35% → Proposal Sent 60% → Negotiation 80% → Closed Won / Lost.
- **Activities.** Every call, note, status change and stage change, with date and time, in one timeline. Notes can be edited.
- **Follow-ups.** Tasks with due dates. Logging a call outcome suggests the next follow-up automatically.
- **Call Mode.** A queue that puts due follow-ups first, then new leads, then retry attempts. It has your script and one-tap calling. On Android the call goes out on your own phone number, and when you return to the app it asks for the outcome.
- **Today dashboard.** Calls, connects, meetings and follow-ups against your daily goals. It shows what's done and what's still to do, plus the last 7 days and a pipeline snapshot.
- **Suggestions.** A box at the bottom of every page. Suggestions are saved to the Suggestions tab of the sheet, and the app shows similar earlier suggestions and their decisions so nothing gets decided twice.

## Development
```bash
npm install
npm run dev            # browser at http://localhost:5173
npm run electron:dev   # desktop shell
```
