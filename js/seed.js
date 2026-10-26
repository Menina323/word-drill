/**
 * seed.js — JSON / CSV vocabulary import.
 *
 * Supported JSON: KyleBing/english-vocabulary (word + translations), the
 * app's own export shape, and a generic array of {text, phonetic, definition}.
 * Supported CSV: word,phonetic,definition or word,phonetic.
 */

const WORD_KEYS = ['word', 'text', 'headword', 'name'];
const PHONETIC_KEYS = ['phonetic', 'phonetics', 'ipa', 'usphone', 'ukphone', 'phone', 'pronunciation'];
const DEFINITION_KEYS = [
  'definition',
  'definitions',
  'meaning',
  'meanings',
  'translation',
  'translations',
  'explanation',
  'gloss',
];

function firstString(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) {
      const joined = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .join('；');
      if (joined) return joined;
    }
  }
  return '';
}

export function translationText(translations) {
  if (typeof translations === 'string') return translations.trim();
  if (!Array.isArray(translations)) return '';

  const parts = [];
  for (const item of translations) {
    if (item === null || item === undefined) continue;
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) parts.push(text);
      continue;
    }
    if (typeof item !== 'object') continue;

    const text = String(
      item.translation ?? item.meaning ?? item.definition ?? item.text ?? item.zh ?? '',
    ).trim();
    if (!text) continue;

    let type = String(item.type ?? item.pos ?? item.partOfSpeech ?? '').trim();
    if (type && !/[.。]$/.test(type)) type += '.';
    parts.push(type ? `${type} ${text}` : text);
  }

  // Preserve order but drop exact duplicates.
  const seen = new Set();
  return parts
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join('；');
}

export function mapRawWord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = firstString(raw, WORD_KEYS);
  if (!text) return null;

  const phonetic = firstString(raw, PHONETIC_KEYS);
  let definition = '';

  if (raw.translations !== undefined) definition = translationText(raw.translations);
  if (!definition && raw.definitions !== undefined) definition = translationText(raw.definitions);
  if (!definition) definition = firstString(raw, DEFINITION_KEYS);
  if (!definition && raw.translation !== undefined) definition = translationText(raw.translation);

  return {
    text: text.replace(/\s+/g, ' ').trim(),
    phonetic: phonetic.replace(/\s+/g, ' ').trim(),
    definition: String(definition ?? '').replace(/\r\n/g, '\n').trim(),
  };
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];
  let duplicates = 0;
  for (const entry of entries) {
    if (!entry?.text) continue;
    const key = entry.text;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    result.push({
      text: entry.text,
      phonetic: entry.phonetic || '',
      definition: entry.definition || '',
    });
  }
  return { entries: result, duplicates };
}

export function parseJsonText(input) {
  let text = String(input ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('内容为空');

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  let rows;
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === 'object') {
    const candidate = data.words ?? data.data ?? data.list ?? data.vocabulary ?? data.items;
    if (Array.isArray(candidate)) rows = candidate;
    else if (firstString(data, WORD_KEYS)) rows = [data];
    else {
      // An object keyed by word, e.g. {"ability": {...}}
      rows = Object.entries(data).map(([word, value]) => {
        if (value && typeof value === 'object') return { word, ...value };
        return { word, definition: typeof value === 'string' ? value : '' };
      });
    }
  } else {
    throw new Error('JSON 顶层必须是数组或对象');
  }

  const mapped = [];
  for (const row of rows) {
    const entry = mapRawWord(row);
    if (entry) mapped.push(entry);
  }
  if (!mapped.length) throw new Error('没有找到可导入的词条');

  const deduped = dedupeEntries(mapped);
  return {
    entries: deduped.entries,
    total: mapped.length,
    duplicatesInFile: deduped.duplicates,
  };
}

/** RFC 4180-ish CSV parser with quoted fields and embedded newlines. */
export function parseCsvRows(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '');
}

function findColumn(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

export function parseCsvText(input, { mode = 'full' } = {}) {
  const rows = parseCsvRows(input);
  if (!rows.length) throw new Error('CSV 内容为空');

  const header = rows[0].map(normalizeHeader);
  const looksLikeHeader = header.some((cell) =>
    ['word', 'text', '单词', 'phonetic', '音标', 'definition', 'meaning', '释义', '翻译'].includes(cell),
  );

  let wordIndex = 0;
  let phoneticIndex = mode === 'phonetic' ? 1 : 1;
  let definitionIndex = mode === 'phonetic' ? -1 : 2;
  let start = 0;

  if (looksLikeHeader) {
    start = 1;
    wordIndex = findColumn(header, ['word', 'text', '单词']);
    const pIndex = findColumn(header, ['phonetic', 'ipa', '音标', 'pronunciation']);
    const dIndex = findColumn(header, ['definition', 'meaning', '释义', '翻译', 'translation']);
    if (wordIndex < 0) wordIndex = 0;
    if (pIndex >= 0) phoneticIndex = pIndex;
    if (dIndex >= 0) definitionIndex = dIndex;
  }

  const entries = [];
  for (let i = start; i < rows.length; i += 1) {
    const cells = rows[i];
    const text = String(cells[wordIndex] ?? '').trim();
    if (!text) continue;
    const phonetic = String(cells[phoneticIndex] ?? '').trim();
    const definition = definitionIndex >= 0 ? String(cells[definitionIndex] ?? '').trim() : '';
    entries.push({ text, phonetic, definition });
  }
  if (!entries.length) throw new Error('CSV 中没有有效单词');

  if (mode === 'phonetic') {
    return { entries, total: entries.length, duplicatesInFile: 0 };
  }

  const deduped = dedupeEntries(entries);
  return {
    entries: deduped.entries,
    total: entries.length,
    duplicatesInFile: deduped.duplicates,
  };
}

export function parseVocabularyText(text, filename = '') {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return parseCsvText(text);
  if (lower.endsWith('.json')) return parseJsonText(text);
  const trimmed = String(text ?? '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJsonText(text);
  return parseCsvText(text);
}

export function guessImportKind(text, filename = '') {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  const trimmed = String(text ?? '').trim();
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? 'json' : 'csv';
}
