import { CSSProperties } from 'react';

/**
 * Shared inline-style objects for the email templates. Email clients strip
 * <style>/external CSS, so every visual rule lives here as an inline style and
 * the templates compose these. Keeping the theme in one place means a colour or
 * spacing change touches a single file.
 */

export const colors = {
  page: '#f5f3ee',
  ink: '#1a1a1a',
  muted: '#444444',
  accent: '#7a5c00',
  rule: '#dddddd',
} as const;

const serif = "'Frank Ruhl Libre', Georgia, 'Times New Roman', serif";

export const main: CSSProperties = {
  margin: 0,
  background: colors.page,
  fontFamily: serif,
};

export const container: CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
  padding: 24,
};

export const h1: CSSProperties = {
  fontSize: 22,
  color: colors.ink,
  margin: '0 0 16px',
};

export const intro: CSSProperties = {
  color: colors.muted,
  margin: '0 0 8px',
};

export const tractateHeading: CSSProperties = {
  fontSize: 18,
  margin: '24px 0 8px',
  color: colors.ink,
};

export const refLabel: CSSProperties = {
  fontWeight: 'bold',
  color: colors.accent,
  margin: '0 0 2px',
};

/** The mishna body. The text itself is Hebrew, so this block is right-to-left. */
export const hebrewText: CSSProperties = {
  lineHeight: 1.9,
  color: colors.ink,
  margin: '0 0 14px',
};

export const hr: CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${colors.rule}`,
  margin: '28px 0 16px',
};

/** The footer's first line: the sender name. */
export const footer: CSSProperties = {
  color: '#888888',
  fontSize: 13,
  lineHeight: 1.6,
  margin: '0',
};

/**
 * The footer's second line: the visible unsubscribe link. It's a separate paragraph
 * (not appended to the brand line) so the plain-text part puts the URL on a line of
 * its own — see the comment in `components/email-shell.tsx`.
 */
export const footerUnsubscribe: CSSProperties = {
  ...footer,
  margin: '4px 0 0',
};

export const footerLink: CSSProperties = {
  color: colors.accent,
  textDecoration: 'underline',
};

export const button: CSSProperties = {
  display: 'inline-block',
  background: colors.accent,
  color: '#ffffff',
  textDecoration: 'none',
  padding: '10px 20px',
  borderRadius: 6,
};

/**
 * The top call-to-action ("Click here when you've memorized this."). Deliberately
 * heavier than {@link button}: it is the one thing in the email we want acted on, and
 * unlike the unsubscribe footer it sits above the mishna list, so Gmail's ~102 KB
 * clipping can never bury it.
 */
export const ctaTop: CSSProperties = {
  ...button,
  display: 'block',
  textAlign: 'center',
  padding: '14px 24px',
  fontSize: 16,
  fontWeight: 'bold',
};

/**
 * The paragraph the top CTA sits in. Its own block, for the same reason the footer's
 * unsubscribe link is its own: `toPlainText` renders an anchor as "text href", so
 * sharing a paragraph with the intro would bury the URL mid-sentence in the
 * text/plain part.
 */
export const ctaTopWrap: CSSProperties = {
  margin: '0 0 24px',
};
