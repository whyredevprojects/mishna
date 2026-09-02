import { ReactNode } from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components';
import * as styles from '../styles';

interface EmailShellProps {
  /** The visible heading and the preheader text shown in the inbox preview. */
  title: string;
  appOrigin: string;
  /**
   * The recipient's signed one-click unsubscribe URL. Rendered as a **visible**
   * footer link: Gmail's bulk-sender rules require an in-body unsubscribe link in
   * addition to the RFC 8058 `List-Unsubscribe` headers `sender.ts` sets.
   */
  unsubscribeUrl?: string;
  /**
   * The recipient's signed "I've memorized this" URL. Rendered as a prominent CTA
   * **above** the content — the one action we want taken, and the reason it goes at
   * the top rather than beside the footer: Gmail clips messages over ~102 KB, and a
   * long weekly can reach that, so anything below the list may simply not be there.
   *
   * Omitted when the email has no mishnayot in it (the empty state) — "click when
   * you've memorized this" over an empty list is nonsense. That decision belongs to
   * the two templates, which know whether their list is empty; this shell just
   * renders what it is handed.
   */
  memorizedUrl?: string;
  children: ReactNode;
}

/**
 * The shared chrome for every email: page background, centered container, the
 * heading, the "I've memorized this" call-to-action, the "Open the app" button, and
 * the unsubscribe footer.
 * English/LTR — only the mishna text inside `children` is rendered right-to-left.
 */
export function EmailShell({
  title,
  appOrigin,
  unsubscribeUrl,
  memorizedUrl,
  children,
}: EmailShellProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{title}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Heading as="h1" style={styles.h1}>
            {title}
          </Heading>
          {/*
            The top CTA, above the content. Its own paragraph, not appended to the
            intro line: `toPlainText` renders an anchor as "text href", so sharing a
            paragraph would bury the URL mid-sentence in the text/plain part — the
            same reasoning as the unsubscribe footer below. Don't collapse it.
          */}
          {memorizedUrl ? (
            <Text style={styles.ctaTopWrap}>
              <Button href={memorizedUrl} style={styles.ctaTop}>
                Click here when you&apos;ve memorized this.
              </Button>
            </Text>
          ) : null}
          {children}
          <Hr style={styles.hr} />
          <Button href={`${appOrigin}/dashboard`} style={styles.button}>
            Open the app
          </Button>
          {/*
            Footer. Sender name + a visible unsubscribe link, which is what Gmail
            and Yahoo look for alongside the List-Unsubscribe headers.
            TODO: if these emails ever become commercial (rather than the
            service mail of a study group people opt into), CAN-SPAM also wants a
            physical postal address here.
          */}
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            {/*
              The product name, not the domain — it must match the `From:` display
              name (config/domains.json) and the unsubscribe landing page, or the
              footer reads like someone else's mail.
            */}
            Chevras Mishnayos Baal Peh
          </Text>
          {/*
            The unsubscribe link is its own paragraph, not " · Unsubscribe" appended
            to the brand line. This is for the *plain-text* part (`toPlainText` over
            this HTML, in templates/index.tsx): html-to-text renders an anchor as
            "text href", so a single-line footer would read
            "Chevras Mishnayos Baal Peh · Unsubscribe https://…" with the URL buried
            mid-sentence, where text-only clients (and users copy-pasting) mangle it.
            Two paragraphs put it on a line of its own. Don't collapse these back.
          */}
          {unsubscribeUrl ? (
            <Text style={styles.footerUnsubscribe}>
              <Link href={unsubscribeUrl} style={styles.footerLink}>
                Unsubscribe
              </Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
