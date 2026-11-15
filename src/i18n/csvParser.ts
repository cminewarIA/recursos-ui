export interface ParsedDictionaryCatalog {
  meta: {
    default_locale: string;
    supported_locales: string[];
    locale_names: Record<string, string>;
    source_format?: string;
  };
  flat: Record<string, Record<string, string>>;
}

const META_COLUMNS = new Set(['key', 'clave', 'context', 'contexto', 'notes', 'notas', 'comment', 'comentario']);

function inferDisplayName(code: string): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames([code], { type: 'language' });
      const label = dn.of(code);
      if (label) {
        return label.charAt(0).toUpperCase() + label.slice(1);
      }
    }
  } catch {
    // ignore Intl errors
  }
  return code.toUpperCase();
}

function detectDelimiter(headerLine: string): string {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') commas++;
      else if (ch === ';') semis++;
    }
  }
  return semis > commas ? ';' : ',';
}

function parseRfc4180Rows(csvText: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      if (ch === '\r' && csvText[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parsea `./i18n/dictionary.csv` en formato hoja de cálculo.
 * Cualquier columna nueva (`fr`, `de`, `pt`, ...) añadida en Excel / Calc / Sheets
 * se descubre automáticamente sin modificar código.
 */
export function parseCsvDictionary(rawCsv: string): ParsedDictionaryCatalog {
  const clean = (rawCsv || '').replace(/^\uFEFF/, '').replace(/^[\r\n]+/, '');
  const firstNewline = clean.search(/\r?\n/);
  const firstLine = firstNewline >= 0 ? clean.slice(0, firstNewline) : clean;
  const delimiter = detectDelimiter(firstLine);
  const rows = parseRfc4180Rows(clean, delimiter);

  if (rows.length === 0) {
    return {
      meta: { default_locale: 'es', supported_locales: ['es'], locale_names: { es: 'Español' }, source_format: 'csv' },
      flat: { es: {} },
    };
  }

  const headers = rows[0].map((h) => h.trim());
  const keyIdxCandidate = headers.findIndex((h) => h.toLowerCase() === 'key' || h.toLowerCase() === 'clave');
  const keyIdx = keyIdxCandidate >= 0 ? keyIdxCandidate : 0;

  const langEntries: Array<{ code: string; idx: number }> = [];
  headers.forEach((h, idx) => {
    if (!h || idx === keyIdx || META_COLUMNS.has(h.toLowerCase())) return;
    langEntries.push({ code: h, idx });
  });

  if (langEntries.length === 0) {
    langEntries.push({ code: 'es', idx: Math.min(1, headers.length - 1) });
  }

  const supportedLocales = langEntries.map((l) => l.code);
  let defaultLocale = supportedLocales[0] || 'es';
  const localeNames: Record<string, string> = {};
  const flat: Record<string, Record<string, string>> = {};

  for (const { code } of langEntries) {
    localeNames[code] = inferDisplayName(code);
    flat[code] = {};
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const key = (row[keyIdx] || '').trim();
    if (!key || key.startsWith('#')) continue;

    if (key === '__locale_name__') {
      for (const { code, idx } of langEntries) {
        const display = (row[idx] || '').trim();
        if (display) localeNames[code] = display;
      }
      continue;
    }

    if (key === '__default_locale__') {
      for (const { code, idx } of langEntries) {
        const flag = (row[idx] || '').trim().toLowerCase();
        if (['1', 'true', 'yes', 'si', 'sí', 'default', '*'].includes(flag)) {
          defaultLocale = code;
          break;
        }
      }
      continue;
    }

    for (const { code, idx } of langEntries) {
      const val = row[idx];
      if (val !== undefined && val !== '') {
        flat[code][key] = val;
      }
    }
  }

  return {
    meta: {
      default_locale: defaultLocale,
      supported_locales: supportedLocales,
      locale_names: localeNames,
      source_format: 'csv',
    },
    flat,
  };
}
