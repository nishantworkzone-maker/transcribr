// services/pii.js
// Detects and masks personally identifiable information (PII) from transcript text
// Works as a fallback when engine-level PII redaction is not available (e.g. Groq)

// These are regular expressions — patterns that find specific text shapes
const PII_PATTERNS = [
  {
    name: 'email',
    // Matches: user@example.com, name.surname@company.co.uk
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL REDACTED]'
  },
  {
    name: 'phone_us',
    // Matches: (555) 123-4567, 555-123-4567, +1 555 123 4567
    regex: /(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g,
    replacement: '[PHONE REDACTED]'
  },
  {
    name: 'phone_india',
    // Matches Indian mobile numbers: +91 9876543210, 9876543210
    regex: /(\+91[\s\-]?)?[6-9]\d{9}/g,
    replacement: '[PHONE REDACTED]'
  },
  {
    name: 'credit_card',
    // Matches: 4111 1111 1111 1111, 4111-1111-1111-1111
    regex: /\b(?:\d[ \-]?){13,16}\b/g,
    replacement: '[CARD REDACTED]'
  },
  {
    name: 'ssn',
    // Matches US Social Security Numbers: 123-45-6789
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[SSN REDACTED]'
  },
  {
    name: 'aadhaar',
    // Matches Indian Aadhaar number: 1234 5678 9012
    regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    replacement: '[AADHAAR REDACTED]'
  }
];

/**
 * Detects PII in text and returns masked version with a list of what was found
 * @param {string} text - The transcript text to scan
 * @returns {{ masked: string, detected: Array<{type: string, count: number}> }}
 */
export function detectAndMaskPII(text) {
  if (!text) return { masked: '', detected: [] };

  let masked = text;
  const detected = [];

  for (const pattern of PII_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches && matches.length > 0) {
      detected.push({ type: pattern.name, count: matches.length });
      masked = masked.replace(pattern.regex, pattern.replacement);
    }
  }

  return { masked, detected };
}

/**
 * Just check if PII exists without masking
 * @param {string} text
 * @returns {boolean}
 */
export function hasPII(text) {
  return PII_PATTERNS.some(p => p.regex.test(text));
}
