# Carpool Dismissal App

A Google Sheets-backed dismissal app designed to be hosted on Vercel and managed in GitHub.

## What this includes

- One unified web app with Entry, Display, Queue, Community, and Admin views
- Google Apps Script backend API
- Google Sheets data source
- Community colors controlled from a `Communities` sheet
- Teacher/community view with vibration and sound alert support
- Installable mobile/tablet-friendly web app shell

## Google Sheet tabs

Use the Admin view's **Create/Check Sheets** button after pasting your spreadsheet ID and Apps Script URL. It will create/check these tabs:

### Students
`Card Number | Student Name | Community | Grade | Active`

### Pickups
`Timestamp | Card Number | Row | Student Name | Submission ID | Status | Submitted By | Device`

### Communities
`Community | Background Color | Text Color | Sort Order | Active`

Example:

`SH | #FF6B00 | #FFFFFF | 1 | TRUE`

Changing a community name or color in this tab updates the app after reload.

### Settings
`Key | Value`

Reserved for future school-wide settings.

## Setup steps

1. Create or open the Google Sheet.
2. Open Google Apps Script from the spreadsheet.
3. Paste `apps-script/Code.gs` into Apps Script.
4. Deploy as a Web App.
   - Execute as: Me
   - Who has access: Anyone with the link, or your organization if that works for your devices
5. Copy the Web App URL.
6. Deploy this app folder to Vercel.
7. Open the Vercel URL, go to Admin, paste the Apps Script URL and Spreadsheet ID, then click **Create/Check Sheets**.
8. Add students to the Students tab.
9. Use Entry for carline staff, Display for the TV/projector, and Community for teachers.

## Suggested URLs

Because this is a single-page app, use the buttons or these hash URLs:

- `/#entry`
- `/#display`
- `/#queue`
- `/#community`
- `/#admin`

## Notes

The app intentionally keeps Google Sheets as the data source for now. That keeps the tool easy to audit, fix, and operate during school dismissal while GitHub and Vercel make the app feel more polished and easier to maintain.
