# Wafr → TestFlight (no Mac needed)

The iOS app is a Capacitor wrapper of `index.html` (`ios/`, `capacitor.config.json`, `scripts/build-www.js`).
Codemagic builds it on a cloud Mac using `codemagic.yaml` and uploads it to TestFlight.
Bundle ID: `com.hamadaljneibi.wafr` · App name: Wafr · iPhone only · iOS 15+.

## One-time setup
1. **Apple — register the App ID** — developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → + →
   App IDs → App → Description `Wafr`, Bundle ID *Explicit* `com.hamadaljneibi.wafr` → Continue → Register.
2. **App Store Connect — create the app** — appstoreconnect.apple.com → Apps → + → New App → iOS, Name `Wafr`
   (if taken, e.g. `Wafr Budget`), Primary language, Bundle ID `com.hamadaljneibi.wafr`, SKU `wafr-ios` → Create.
3. **App Store Connect — API key** — Users and Access → Integrations → App Store Connect API → Team Keys → + →
   name `Codemagic`, access **App Manager** → Generate. Note the **Issuer ID** and **Key ID**, download the `.p8`
   file (only downloadable once).
4. **Codemagic — connect** — codemagic.io → sign in with GitHub → Add application → `7md2007/wafr` →
   type **Capacitor / codemagic.yaml**.
5. **Codemagic — add the key** — Team settings → Team integrations → Developer Portal → Manage keys → Add key →
   name exactly `Wafr ASC`, paste Issuer ID, Key ID, upload the `.p8`.
6. **Codemagic — signing certificate** — Team settings → codemagic.yaml settings → Code signing identities →
   iOS certificates → Generate certificate → key `Wafr ASC`, type **Apple Distribution**.
7. **Apple — provisioning profile** — developer.apple.com → Profiles → + → **App Store Connect** → App ID
   `com.hamadaljneibi.wafr` → pick the certificate Codemagic just made → name `Wafr App Store` → Generate.
8. **Codemagic — fetch the profile** — Code signing identities → iOS provisioning profiles → Fetch profiles →
   select `Wafr App Store`.

## Each build
Codemagic → the Wafr app → **Start new build** → workflow **Wafr iOS → TestFlight**. ~10–15 min later the build is
in App Store Connect → TestFlight. Add yourself under **Internal Testing** (internal builds need no Apple review),
then install with the **TestFlight** app on your iPhone.

## Notes
- Data saved in the Home Screen web app does not move by itself: More → Copy a backup, then Restore in the iOS app.
- Changing `index.html` needs a new build to reach the TestFlight app (the web version updates as before).
