# Windows code signing for Grindlog (research, 2026-11-06)

## Summary table

| Option | Cost per year | Individual eligible | Warning removed when | Works in CI |
|---|---|---|---|---|
| Azure Artifact Signing (Basic) | about $120 (Microsoft states "starts at $9.99/month") | Yes, but individuals must be in the US or Canada | Not immediately: reputation builds with downloads | Yes (official GitHub Action, Windows runners only) |
| SignPath Foundation (free OSS) | $0 | Unclear (terms speak of a "team"); needs verifiable reputation | Not stated; Microsoft says OV/EV both start with a warning | Yes (GitHub-hosted runners) |
| Certum Open Source cert | from EUR 69 (card + reader included; validity not stated on page) | Yes, issued to a natural person as "Open Source Developer" | Not immediately (Microsoft: OV/EV warn until reputation) | Hard: physical smart card + reader; cloud variant not confirmed |
| SSL.com IV / OV / EV | Not listed publicly (quote only) | IV and EV Sole Proprietor are for individuals | Not immediately | Yes via eSigner cloud HSM |
| DigiCert | $696 (likely OV), $972 (likely EV) per page; labels unconfirmed | Page does not say; reads as organization-only | Not immediately | KeyLocker cloud offered |
| Unsigned (current) | $0 | n/a | Never; reputation restarts on every new version | n/a |

## What the sources say

**Warning timing, all options.** SmartScreen uses publisher reputation and file-hash reputation; "even when signed, a newly created binary could still show a SmartScreen warning." Microsoft's table lists "Valid Certificate (OV/EV)" as Warning on first download, with the verified publisher name shown. Microsoft says "EV certificates no longer bypass SmartScreen... Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified." Reputation "can take several weeks and hundreds of clean installs from a wide audience." Unsigned files start from zero on every new version; signed files can carry reputation across versions under the same identity. Only the Microsoft Store avoids the warning outright.
https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation

Windows 11 Smart App Control "will block execution of unsigned files unless the file has a positive reputation" (same page). This applies to all executables, not only downloaded ones.

**Azure Artifact Signing.**
- Price: the page above says "Starts at $9.99/month". The Azure pricing page itself shows only placeholders ("$-"); it lists Basic at 5,000 signatures per month and Premium at 100,000. https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- Billing is the full SKU price, not pro-rated. Needs a paid Azure subscription: free, trial and sponsored subscriptions are refused. https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- Eligibility: organizations in the US, Canada, EU, UK, Australia, NZ, Japan, South Korea, Singapore, Switzerland, Norway, Israel. "Individual developers must be located in the United States or Canada." https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- Individual validation: Azure billing account of type Individual; legal name and address must match a government ID; ID check via Microsoft Authenticator Verified ID with a face check (same quickstart and FAQ). Organization validation takes 1 to 20 business days (quickstart); no stated time for individuals.
- Certificates are valid 3 days, so timestamping is required (`http://timestamp.acs.microsoft.com`). No EV, and none planned. https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations and the FAQ above.
- Certificate subject is your validated legal name, no customization (FAQ).
- CI: GitHub Action `azure/artifact-signing-action`, "can only be executed on Windows runners" (windows-2022 and windows-2025 listed), OIDC recommended. https://github.com/Azure/artifact-signing-action
- FAQ on SmartScreen for signed files: the prompt stops once the file hash has enough download history (FAQ above).

**SignPath Foundation.** Free for OSS ("our services are free of charge", https://signpath.org/). Conditions in the draft terms (https://signpath.org/terms.html): OSI license, no commercial dual-licensing, actively maintained, already released in the form to be signed, functionality described on the download page, no malware or PUA, and "for executable programs, we require a certain verifiable reputation" (no numeric threshold given). Binaries must be built from source "in a verifiable way". The certificate is issued to "SignPath Foundation" as publisher, not to you. GitHub Actions with GitHub-hosted runners is supported; the Open Source plan can enforce `required_github_hosted: true`. https://docs.signpath.io/trusted-build-systems/github

**Certificate vendors, rules.** CA/B Forum Code Signing BRs v3.11.0 (16 June 2026): private keys must be generated, stored and used in a hardware crypto module (effective 2023-06-01), and for certificates issued on or after 2026-03-01 validity "MUST NOT exceed 460 days". https://cabforum.org/working-groups/code-signing/requirements/ So a purchased cert means yearly renewal and re-validation; multi-year pricing no longer gives a long-lived cert.
- Certum Open Source: "from EUR 69", hardware smart card (cryptoCertum 3.7) and reader included; RSA 3072 minimum; for developers sharing free or open-source software; subject carries "Open Source Developer" and natural-person data. https://shop.certum.eu/open-source-code-signing.html
- SSL.com: IV (individual), OV, EV Sole Proprietor, EV; all can use eSigner cloud HSM from CI "without a physical token"; keys must be on a FIPS 140-2 token, HSM or eSigner. No prices on page. https://www.ssl.com/certificates/code-signing/
- DigiCert: $696/yr and $972/yr subscriptions, KeyLocker cloud or hardware tokens; individual eligibility not stated. https://www.digicert.com/signing/code-signing-certificates

**Unsigned self-updater and AV.** Microsoft classifies as "unwanted software" anything that installs or removes software without "permission, interaction, or consent", or that downloads other unwanted software; a self-updater is not named, so a consented, disclosed updater of your own app is not in these categories. Unknown software gets "early warning" prompts, not blocks. https://learn.microsoft.com/en-us/defender-xdr/criteria Dispute false positives at https://www.microsoft.com/wdsi/filesubmission (https://learn.microsoft.com/en-us/defender-xdr/submission-guide).

## Own inferences (not stated by a source)

- Artifact Signing at about $120/year is the only paid route that fits CI cleanly, but the user's country may rule it out for an individual. If outside the US/Canada, the realistic paid options are Certum (physical card, awkward in CI) or SSL.com IV via eSigner (price unknown).
- Since no option removes the warning on day one, paying mainly buys a named publisher on the prompt plus reputation that carries across versions. For a small friends-only app, reputation may accumulate slowly (Microsoft says hundreds of installs).
- A file the app downloads itself: SmartScreen is documented as checking files an app "attempts to download and run" (https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/), but the Mark-of-the-Web (Zone.Identifier) is normally written by the downloading program (browsers, via the attachment APIs), so a plain HTTP download from the app's own code likely carries no MOTW and likely triggers no SmartScreen prompt. Inference only; no Microsoft page found that states it. Smart App Control (Win11) is separate and does not depend on MOTW.

## Open questions

- Individual Artifact Signing: exact processing time, and whether non-US/Canada individuals have any exception. The source says none.
- Artifact Signing Basic exact price today: confirm in the Azure pricing calculator (the pricing page shows no numbers).
- SignPath Foundation: whether a single-maintainer project with few users passes the "verifiable reputation" test, and whether individuals are accepted. Only the application at https://signpath.org/apply can settle this; I did not read it.
- SSL.com and Sectigo yearly prices and exact validity under the 460-day rule; Certum validity and cloud option. Sectigo was not read at all.
- MOTW behavior for app-initiated downloads: no primary source found; test by downloading an update with the app and running `Get-Content <file> -Stream Zone.Identifier`.
- Whether non-Microsoft AV vendors flag unsigned self-updaters more: no first-party source found.
