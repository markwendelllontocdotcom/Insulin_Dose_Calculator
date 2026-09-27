# Insulin Dose Calculator

A small iPhone web app that follows the *Flexible Insulin Dose Plan* dated 24 July 2024.
Everything runs on the phone: no accounts, no tracking, nothing saved or sent anywhere.
After the first visit it works offline.

**Helper tool only – always check against the written plan and follow the care team’s advice.**

## Files

| File | What it is |
|---|---|
| `index.html` | The screens (Calculator, Plan, Instructions) |
| `style.css` | Look and layout |
| `app.js` | The dose plan numbers (`DOSE_PLAN` at the top) and all calculations |
| `manifest.json` | Name and icon for the Home Screen |
| `service-worker.js` | Saves the app on the phone so it works offline |
| `icons/` | App icons |
| `tests/calc.test.js` | Automated tests (not needed on the phone) |

## Put it online for free (GitHub Pages)

Do this on a computer – it is much easier than on a phone.

1. Create a free account at <https://github.com> and sign in.
2. Click **+** (top right) → **New repository**. Name it, for example, `dose-calc`.
   Leave it **Public** (free GitHub Pages only works with public repositories).
   Tick **Add a README file** then click **Create repository**.
3. Unzip `insulin-dose-calculator.zip` on your computer.
4. In the new repository click **Add file** → **Upload files**. Drag in everything from the unzipped
   folder: `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js` and the
   `icons` folder (the `tests` folder is optional). Click **Commit changes**.
5. Open **Settings** → **Pages** (left side, under “Code and automation”).
   Under **Build and deployment** → **Source** choose **Deploy from a branch**.
   Choose branch **main** and folder **/ (root)** then click **Save**.
6. Wait a few minutes (GitHub says up to 10). Refresh the Pages settings: the address appears at the top,
   for example `https://YOUR-USERNAME.github.io/dose-calc/`.

Because the repository is public, anyone who finds it can see the plan numbers.
The files contain no name or other personal details.

## Add it to the iPhone Home Screen

1. Open the address in **Safari** while online. Let it load fully (this stores the offline copy).
2. iOS 26: tap **•••** next to the address bar → **Share**.
   Older iOS: tap the **Share** button (square with an arrow) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Keep **Open as Web App** switched on. Keep the name “Insulin Dose” (or change it) then tap **Add**.
5. Open it once from the Home Screen while online. To check offline use: turn on Airplane Mode,
   open the app and type a reading.

## Changing the plan later

1. On GitHub open `app.js`, click the pencil icon and change the numbers in `DOSE_PLAN`
   (also update `planDate`). Click **Commit changes**.
2. Open `service-worker.js` the same way and change `CACHE_VERSION` from `v1` to `v2` (then `v3` next time …).
   Commit. Without this step phones keep the old version.
3. On the iPhone open the app while online. It updates itself when nothing has been typed yet;
   otherwise a blue bar says “A new version is ready – tap here to reload”.
4. Check the **Plan** tab shows the new numbers and date.

## Running the tests (optional, needs Node.js 18 or newer)

```
node --test
```

Run it from this folder. The tests cover the seven required cases, every row of the paper plan’s carb table,
every correction band boundary, the colours, the messages and the clock-based meal time.
