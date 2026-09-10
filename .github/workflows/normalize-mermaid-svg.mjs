#!/usr/bin/env node
// Normaliseert de inline SVG die mermaid in de ReSpec-snapshot genereert, zodat
// het resultaat door de Nu HTML-validator (vnu) komt.
//
// Mermaid gebruikt voor zijn <defs> vaste, niet-genamespacete id's
// (`arrowhead`, `computer`, `flowchart-pointEnd`, ...). Zodra een publicatie
// meer dan één diagram van hetzelfde type bevat, staan die id's dubbel in het
// document en meldt vnu "Duplicate ID". Daarnaast laat mermaid interne
// layout-attributen (`label-offset-x`/`label-offset-y`) op <g>-elementen staan;
// die bestaan niet in SVG en leveren "Attribute ... not allowed on element g".
//
// Deze normalisatie:
//   1. geeft dubbele id's binnen een inline <svg> een prefix op basis van de
//      id van dat <svg>-element, en herschrijft alle verwijzingen ernaar
//      (url(#id), href/xlink:href, CSS-selectors, aria-labelledby/-describedby);
//   2. verwijdert de mermaid-interne layout-attributen.
//
// Alleen de inhoud van inline <svg>-elementen wordt aangepast. Id's van
// ReSpec zelf (sectie-ankers en dergelijke) blijven ongemoeid, zodat
// permalinks niet breken.
//
// Gebruik: node normalize-mermaid-svg.mjs <bestand.html> [meer bestanden...]

import { readFileSync, writeFileSync } from "node:fs";

// Attributen die mermaid achterlaat en die niet in SVG bestaan.
const STRIP_ATTRIBUTES = ["label-offset-x", "label-offset-y"];

const ID_ATTRIBUTE = /\sid="([^"]*)"/g;

/**
 * Zoekt de buitenste <svg>-elementen in de HTML. Geneste <svg>'s worden
 * meegenomen in het bereik van hun ouder.
 */
function findSvgRanges(html) {
  const tag = /<svg\b[^>]*>|<\/svg\s*>/gi;
  const ranges = [];
  let depth = 0;
  let start = -1;
  let match;

  while ((match = tag.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      if (depth === 0) continue; // ongebalanceerde sluittag: negeren
      depth -= 1;
      if (depth === 0) {
        ranges.push({ start, end: match.index + match[0].length });
        start = -1;
      }
      continue;
    }

    if (depth === 0) start = match.index;
    // Zelfsluitende <svg/> komt niet voor in mermaid-output, maar vang het af.
    if (!/\/>$/.test(match[0])) depth += 1;
    else if (depth === 0) {
      ranges.push({ start, end: match.index + match[0].length });
      start = -1;
    }
  }

  return ranges;
}

function collectIdCounts(html) {
  const counts = new Map();
  for (const match of html.matchAll(ID_ATTRIBUTE)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

function rootId(svg) {
  const openTag = svg.slice(0, svg.indexOf(">") + 1);
  return openTag.match(/\sid="([^"]*)"/)?.[1] ?? "";
}

/**
 * Herschrijft dubbele id's binnen één inline <svg> en alle verwijzingen daarnaar.
 */
function rewriteDuplicateIds(svg, index, idCounts, takenIds) {
  const prefix = `${rootId(svg) || `svg-${index + 1}`}-`;
  const renames = new Map();

  for (const match of svg.matchAll(ID_ATTRIBUTE)) {
    const id = match[1];
    if (renames.has(id)) continue;
    if ((idCounts.get(id) ?? 0) < 2) continue;

    let candidate = `${prefix}${id}`;
    let suffix = 2;
    while (takenIds.has(candidate)) candidate = `${prefix}${id}-${suffix++}`;
    takenIds.add(candidate);
    renames.set(id, candidate);
  }

  if (renames.size === 0) return { svg, renames };

  // Eén enkele pass, zodat een nieuwe id niet nogmaals wordt herschreven.
  const pattern =
    /(\sid=")([^"]*)(")|(\s(?:aria-labelledby|aria-describedby)=")([^"]*)(")|#([A-Za-z_][\w.:-]*)/g;

  const rewritten = svg.replace(
    pattern,
    (whole, idPre, idValue, idPost, ariaPre, ariaValue, ariaPost, hashId) => {
      if (idPre !== undefined) {
        return `${idPre}${renames.get(idValue) ?? idValue}${idPost}`;
      }
      if (ariaPre !== undefined) {
        const tokens = ariaValue
          .split(/\s+/)
          .map((token) => renames.get(token) ?? token);
        return `${ariaPre}${tokens.join(" ")}${ariaPost}`;
      }
      return `#${renames.get(hashId) ?? hashId}`;
    },
  );

  return { svg: rewritten, renames };
}

function stripInvalidAttributes(svg) {
  let stripped = 0;
  for (const attribute of STRIP_ATTRIBUTES) {
    const pattern = new RegExp(`\\s${attribute}="[^"]*"`, "g");
    svg = svg.replace(pattern, () => {
      stripped += 1;
      return "";
    });
  }
  return { svg, stripped };
}

function normalize(html) {
  const ranges = findSvgRanges(html);
  if (ranges.length === 0) return { html, renamed: 0, stripped: 0, svgCount: 0 };

  const idCounts = collectIdCounts(html);
  const takenIds = new Set(idCounts.keys());

  let output = "";
  let cursor = 0;
  let renamed = 0;
  let stripped = 0;

  ranges.forEach((range, index) => {
    output += html.slice(cursor, range.start);

    let svg = html.slice(range.start, range.end);
    const idResult = rewriteDuplicateIds(svg, index, idCounts, takenIds);
    svg = idResult.svg;
    renamed += idResult.renames.size;

    const attributeResult = stripInvalidAttributes(svg);
    svg = attributeResult.svg;
    stripped += attributeResult.stripped;

    output += svg;
    cursor = range.end;
  });

  output += html.slice(cursor);
  return { html: output, renamed, stripped, svgCount: ranges.length };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Gebruik: node normalize-mermaid-svg.mjs <bestand.html> [...]");
  process.exit(2);
}

for (const file of files) {
  const original = readFileSync(file, "utf8");
  const { html, renamed, stripped, svgCount } = normalize(original);

  if (html === original) {
    console.log(`${file}: ${svgCount} inline SVG('s), niets aan te passen.`);
    continue;
  }

  writeFileSync(file, html);
  console.log(
    `${file}: ${svgCount} inline SVG('s) genormaliseerd — ` +
      `${renamed} dubbele id('s) herschreven, ${stripped} ongeldig(e) attribu(u)t(en) verwijderd.`,
  );
}
