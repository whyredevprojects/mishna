import { Fragment } from 'react';
import { Heading, Section, Text } from '@react-email/components';
import { ResolvedMishna } from '../../quota';
import * as styles from '../styles';

interface MishnaListProps {
  items: ResolvedMishna[];
}

/**
 * Renders the mishnayot grouped by tractate. Headings and the "Perek/Mishna"
 * labels are English (the tractate's English name is `ref.mesechta`); each
 * mishna's text is Hebrew, so its block is right-to-left. React escapes the text
 * automatically — no manual HTML escaping needed.
 */
export function MishnaList({ items }: MishnaListProps) {
  let currentTractate = '';
  return (
    <Section>
      {items.map((item, i) => {
        const newTractate = item.ref.mesechta !== currentTractate;
        currentTractate = item.ref.mesechta;
        return (
          <Fragment key={i}>
            {newTractate && (
              <Heading as="h2" style={styles.tractateHeading}>
                {item.ref.mesechta}
              </Heading>
            )}
            <Text style={styles.refLabel}>
              Perek {item.ref.perek}, Mishna {item.ref.mishna}
            </Text>
            <Text dir="rtl" style={styles.hebrewText}>
              {item.hebrew}
            </Text>
          </Fragment>
        );
      })}
    </Section>
  );
}
