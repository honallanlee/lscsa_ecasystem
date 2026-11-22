# ECA Fair

Club sign-up and payment for a school fair. Next.js and Postgres, made for Vercel's free plan.
An independent project, not an official school service.

## Put it online

1. Push this repository to GitHub. In Vercel choose **Add New > Project** and pick the repository. Leave the other settings as they are.
2. In the project's **Storage** tab, create a **Neon** Postgres database (free plan) and connect it to **Production** only, so previews never touch real data. This sets `DATABASE_URL`. Choose the same region for the database and for **Settings > Functions**, close to your users.
3. In **Settings > Environment Variables**, add `SETUP_TOKEN` with any long random text.
4. **Redeploy**. The tables are created during a production build.
5. Open `/setup` on your site, enter the setup code, and create your admin login. The page closes itself after that.
6. In **Admin**, import the Clubs, Form rules and Students files. Samples of the first two are in `db/demo`.

To fill it with 990 made-up students instead, copy the database URL into `.env.local` and run `npm run seed:demo`.

## Scanning

The app picks a mode by itself; the link at the bottom of each page switches it, and the choice is remembered on that device.

**Computer mode** is for a keyboard or a handheld (USB or Bluetooth) scanner. There is no camera. Scan a slip and the cursor
moves to the phone number, then to each club as it is scanned, then to Register. On Cashier it moves to the cash box. It works
whether the scanner sends Enter, Tab or nothing after each code, and wherever the cursor happens to be. A scan never presses a button.

**Phone mode** adds **Use camera**. On Register one camera session does everything: scan the student's slip, then each club
label. The browser asks for the camera the first time. It needs https (Vercel is) or `localhost`. Pictures are read on the
phone itself and never leave it.

Print slips and labels from **Admin**. Each has a QR code for phones and a Code 128 barcode for handheld scanners. Older
Code 39 slips and labels also scan.

## Email (optional)

Nothing is emailed unless a cashier presses **Email confirmation**. To turn that button on, add `RESEND_API_KEY` and
`EMAIL_FROM` (an address on a domain you have verified with Resend). Emails stop at 20 a month; change `EMAIL_MONTHLY_CAP` to adjust.

## Run it on your computer

Needs Node 24.

    npm install
    npm install --prefix devtools    # a local Postgres, about 330 MB, never installed on Vercel
    npm run dev                      # http://localhost:3000
    npm test

Local logins are printed when it starts. They exist only on a local database.

## Where things are

| Path | What it is |
|---|---|
| `db/migrations` | The database tables. Add new numbered files; never edit one that has been deployed. |
| `src/lib/rules.ts` | Club rules and money, shared by server and screens |
| `src/lib/service.ts` | Everything staff can do, and the role each action needs |
| `src/lib/auth.ts` | Passwords, sign-in, sessions |
| `src/components` | The screens |
| `tests` | Run against a real Postgres, with simultaneous requests |

## Real students

Students' names, phone numbers and emails are personal data. Use made-up people unless the school has agreed to you holding theirs.
