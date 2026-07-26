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
  children: ReactNode;
}

/**
 * The shared chrome for every email: page background, centered container, the
 * heading, the "Open the app" call-to-action, and the unsubscribe footer.
 * English/LTR — only the mishna text inside `children` is rendered right-to-left.
 */
export function EmailShell({
  title,
  appOrigin,
  unsubscribeUrl,
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
            {unsubscribeUrl ? (
              <>
                {' · '}
                <Link href={unsubscribeUrl} style={styles.footerLink}>
                  Unsubscribe
                </Link>
              </>
            ) : null}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
