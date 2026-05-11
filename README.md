## ReSpec template instructies

ReSpec is een tool om HTML- en PDF-documenten te genereren op basis van markdowncontent. Deze template helpt je bij het opstellen en publiceren van documenten volgens de Geonovum-standaard.

De dynamische voorbeeldpagina van het template is [hier te bekijken](https://geonovum.github.io/NL-ReSpec-GN-template/).

---

## Starten

Gebruik de knop [*Gebruik deze template*](https://github.com/Geonovum/NL-ReSpec-template/generate?description=Geonovum+documenttemplate) om een nieuwe repository aan te maken:

* **Owner:** kies `Geonovum` als je daar rechten voor hebt.
* **Visibility:** kies **Public**.

> ℹ️ Na het aanmaken moet je **handmatig GitHub Pages activeren** in de instellingen van je nieuwe repository:
>
> * Ga naar `Settings` → `Pages`
> * Kies onder “Source” de branch `main` en map `/ (root)`

---

## Gebruikersinstructie

Voor het aanpassen van het document raden we aan om een IDE te gebruiken, zoals [Visual Studio Code](https://code.visualstudio.com/). Deze geeft een voorbeeldweergave van je markdown en helpt bij het beheren van je bestanden.

### Aanpassen van content

* Pas instellingen aan in de configuratiebestanden (`config.js`)
* Voeg markdown-bestanden toe of wijzig bestaande bestanden

### Configuratiebestanden

* [`js/config.js`](js/config.js): bevat document-specifieke instellingen zoals titel, status en auteurs
* [`organisation-config.js`](https://tools.geostandaarden.nl/respec/config/geonovum-config.js): bevat algemene informatie over de organisatie

Beide bestanden worden gelinkt in de [`index.html`](index.html)

### Content schrijven

* Gebruik markdown of HTML
* Splits content idealiter per hoofdstuk in losse bestanden
* Voeg nieuwe secties toe aan de `index.html` via `data-include`:

```html
<section data-include-format="markdown" data-include="ch01.md" class="informative"></section>
<section data-include-format="markdown" data-include="ch02.md"></section>
```

CSS-classes zijn ook bruikbaar in markdown via HTML:

```html
<div class="example">voorbeeld</div>
```

Meer info: [ReSpec documentatie](https://respec.org/docs/#css-classes)

---

## Automatische checks en build

De GitHub Actions workflow draait automatisch bij iedere commit of bij een GitHub Release. Daarbij gebeuren de volgende stappen:

1. HTML wordt gegenereerd met [ReSpec](https://respec.org/)
2. (optioneel) PDF wordt gegenereerd — indien `alternateFormats` is ingesteld in `config.js`:

```js
alternateFormats: [
  {
    label: "pdf",
    uri: "template.pdf",
  },
]
```

3. Automatische controles worden uitgevoerd:

    * HTML-validatie
    * WCAG-check (toegankelijkheid)
    * Linkcheck (controleren van verwijzingen)

De resultaten zijn zichtbaar in het tabblad **Actions** van je repository.

---

## Publiceren van documenten

Wanneer je document klaar is, publiceer je via **GitHub Releases**:

### Pre-release (testomgeving)

* Ga naar het tabblad **Releases** in je eigen repo
* Klik op **“Create a new release”**
* Geef een tag aan bij, Choose a tag (bijv. `v0.1.0`) en klik op **“Create new tag”**
* **Vink aan:** “This is a pre-release” onderop deze pagina
* Klik op **“Publish release”**

💡 Dit publiceert je document automatisch op:
https://test.docs.geostandaarden.nl/

(De exacte URL wordt bepaald door waarden in `config.js`)

### Release (productieomgeving)

* Ga opnieuw naar **Releases**
* Klik op **“Create a new release”**
* Geef een tag aan bij, Choose a tag (bijv. `v0.1.0`) en klik op **“Create new tag”**
* Laat “pre-release” uitgevinkt
* Klik op **“Publish release”**

💡 Dit maakt automatisch een **Pull Request** aan naar:
[`Geonovum/docs.geostandaarden.nl`](https://github.com/Geonovum/docs.geostandaarden.nl/pulls)

Na goedkeuring van de PR wordt het document gepubliceerd op:
https://docs.geostandaarden.nl/

---

## Workflows updaten in document-repos

De GitHub Actions workflows in alle document-repositories kunnen centraal
bijgewerkt worden vanuit deze template via de workflow
**"Update workflows in document repos"**.

### Repos bijhouden (automatisch)

Bij elke run wordt [`.github/repos.json`](.github/repos.json) eerst
automatisch bijgewerkt:

* Repos met `js/config.js` die **nog niet in de lijst staan** worden
  toegevoegd met `"updateAllow": true`
* Repos met `js/config.js` krijgen ook `respecBuildUrl` en
  `respecVersion` mee op basis van `index.html` en `snapshot.html`
* Repos die **gearchiveerd of verwijderd** zijn worden uit de lijst verwijderd
* De bijgewerkte `repos.json` wordt terug gecommit naar deze template repo

Wil je een repo **uitsluiten** van updates, zet dan
`"updateAllow": false` in `repos.json`. Die repo wordt dan nooit meer
aangeraakt, ook niet bij toekomstige runs.

Repos met een `config.js` in de root (maar nog niet in `js/`) krijgen een
aparte PR om dit bestand te verplaatsen naar `js/config.js` en meteen de
beheerde `.github`-bestanden uit deze template mee te nemen. Zo'n repo
wordt pas bij een volgende run automatisch aan `repos.json` toegevoegd,
nadat de migratie-PR is gemerged.

### Handmatig triggeren

Ga naar
[Actions → Update workflows in document repos](https://github.com/Geonovum/NL-ReSpec-template/actions/workflows/update-workflows.yml)
en klik op **"Run workflow"**.

* **Dry run** aanvinken om te zien welke repos bijgewerkt zouden worden,
  zonder te committen of PRs aan te maken.

### Wat wordt bijgewerkt?

Alleen een vaste set templatebestanden wordt bijgewerkt. Bestaande andere
bestanden onder `.github/`, zoals extra workflows of templates, blijven
onaangeraakt.

De volgende bestanden worden bijgewerkt:

* `.github/dependabot.yml`
* `.github/workflows/build.yml`
* `.github/workflows/main.yml`
* `.github/workflows/pdf.js`
* `.github/workflows/publish.yml`