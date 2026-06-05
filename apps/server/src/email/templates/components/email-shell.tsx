import { ReactNode } from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
} from '@react-email/components';
import * as styles from '../styles';

interface EmailShellProps {
  /** The visible heading and the preheader text shown in the inbox preview. */
  title: string;
  appOrigin: string;
  children: ReactNode;
}

/**
 * The shared chrome for every email: page background, centered container, the
 * heading, and the "Open the app" call-to-action. English/LTR — only the mishna
 * text inside `children` is rendered right-to-left.
 */
export function EmailShell({ title, appOrigin, children }: EmailShellProps) {
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
        </Container>
      </Body>
    </Html>
  );
}
