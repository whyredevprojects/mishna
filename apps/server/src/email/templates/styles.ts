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

export const button: CSSProperties = {
  display: 'inline-block',
  background: colors.accent,
  color: '#ffffff',
  textDecoration: 'none',
  padding: '10px 20px',
  borderRadius: 6,
};
