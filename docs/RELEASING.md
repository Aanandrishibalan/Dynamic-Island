# Publishing to GitHub and making a release

## Before the first publish

1. **Choose a licence.** With no `LICENSE` file, all rights are reserved. In GitHub: *Add file > Create new file*, name it `LICENSE`, and use the *Choose a license template* button, or add your own.
2. **Decide the app id.** `dynamic-island/package.json` has `"appId": "com.example.dynamicisland"`. Windows ties the installer's identity to it, so changing it after people have installed makes the next update install side by side instead of over the old one. Set a final value now (for example `io.github.<your-user>.dynamicisland`).
3. Optionally add `"repository"` and `"license"` fields to `package.json`.
4. Run the tests: `cd dynamic-island && npm test`.

## 1. Put the code on GitHub

Create an empty repository on github.com (no README, no .gitignore, no licence: this repo already has them). Then, in the folder that contains `README.md`:

```bash
git init -b main
git add .
git commit -m "Windows Dynamic Island 1.4.1"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

The *Tests* workflow runs on every push and pull request. Check the *Actions* tab for a green tick.

## 2. Make a release: automatic (recommended)

The *Release* workflow builds on a Windows machine at GitHub and attaches the files for you.

1. Set the version in `dynamic-island/package.json` (for example `"version": "1.4.2"`) and add a section to `CHANGELOG.md`.
2. Commit and push:
   ```bash
   git add -A && git commit -m "Release 1.4.2" && git push
   ```
3. Tag the commit and push the tag. The tag must be `v` + the package.json version:
   ```bash
   git tag v1.4.2
   git push origin v1.4.2
   ```
4. Open the *Actions* tab and watch *Release*. It takes about 5 to 10 minutes. When it finishes, the **Releases** page has a new release with:
   - `Dynamic.Island-1.4.2-installer.exe`
   - `Dynamic.Island-1.4.2-portable.exe`
   - the automatically attached *Source code (zip / tar.gz)*, and release notes generated from your commits.
5. Open the release, edit the notes if you like (paste the CHANGELOG section), and press **Update release**.

If the build fails because the tag and version differ, delete the tag and redo it:

```bash
git tag -d v1.4.2 && git push origin :refs/tags/v1.4.2
```

You can also test the build without releasing: *Actions > Release > Run workflow*. The installer and portable exe are then saved as a downloadable *windows-builds* artifact on that run, and no release is created.

## 3. Make a release: by hand (on your own PC)

1. On Windows, double-click `dynamic-island/build-windows.bat` (or `npm install` then `npm run dist` inside `dynamic-island`). The files appear in `dynamic-island/dist/`:
   - `Dynamic Island-<version>-installer.exe`
   - `Dynamic Island-<version>-portable.exe`
2. On GitHub open your repository, then **Releases > Draft a new release**.
3. **Choose a tag**: type `v<version>` (for example `v1.4.1`) and pick *Create new tag on publish*.
4. Set the title (for example `Windows Dynamic Island 1.4.1`) and paste the notes from `CHANGELOG.md`.
5. Drag the two `.exe` files into the *Attach binaries* box and wait for the uploads to finish.
6. Tick **Set as the latest release** and press **Publish release**. Use *Save draft* instead to review first, or tick *Set as a pre-release* for a test build.

### Same thing from the command line

With the [GitHub CLI](https://cli.github.com) (`gh auth login` once):

```bash
cd dynamic-island
gh release create v1.4.1 "dist/Dynamic Island-1.4.1-installer.exe" "dist/Dynamic Island-1.4.1-portable.exe" \
  --title "Windows Dynamic Island 1.4.1" --notes-file ../CHANGELOG.md
```

## Good to know

- **SmartScreen warning.** The builds are not code-signed, so Windows may show "Windows protected your PC" the first time. Users choose *More info > Run anyway*. Removing the warning needs a code-signing certificate, which is not set up here.
- **File names.** GitHub changes spaces in uploaded file names to dots, so the Releases page shows `Dynamic.Island-1.4.1-installer.exe`.
- **Updating users.** Installing a new build over the old one is enough; the installer closes a running island first.
- **Never commit** passwords, API keys, `.env` files or certificates. `.gitignore` already blocks the common ones.
- **Large files.** GitHub rejects files over 100 MB. The whisper.cpp binaries and models are not in the repo; each user downloads them (see `dynamic-island/whisper/README.txt`).
