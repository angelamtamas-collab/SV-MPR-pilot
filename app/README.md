# MPR Maker (web app)

`index.html` is the whole app in one file: open it in Chrome, Edge, Firefox or Safari 17+,
from a web link or by double-clicking it. Teachers upload their Skyward report and Edgenuity
Group Progress PDF, review each student, and download the `MPR DV <LastName> <Month Year>` folder.

Everything runs inside the browser tab. No files are uploaded or stored anywhere.

Live site (GitHub Pages): https://angelamtamas-collab.github.io/SV-MPR-pilot/

## Changing the app
1. Edit the readable files in `source/` (`mpr-core.js` = parsing, rules, report drawing;
   `app.js` = screens; `index.html` = page and styles).
2. Rebuild the single file: `python3 scripts/build_standalone.py`
3. Open `app/index.html` and test with real exports before sharing it.

The staff password is checked against a SHA-256 hash in `source/index.html` (search for `HASH`).
To change it, replace that hash with the hash of the new password and rebuild.
